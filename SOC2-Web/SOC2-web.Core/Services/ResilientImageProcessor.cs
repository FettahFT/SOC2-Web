using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;

namespace ShadeOfColor2.Core.Services;

public class ResilientImageProcessor : IImageProcessor
{
    private readonly StreamingImageProcessor _streamingProcessor;
    private readonly ImageProcessor _fallbackProcessor;
    private readonly StreamingConfiguration _config;
    private readonly SemaphoreSlim _concurrencyLimiter;

    public ResilientImageProcessor(StreamingConfiguration config)
    {
        _streamingProcessor = new StreamingImageProcessor();
        _fallbackProcessor = new ImageProcessor();
        _config = config;
        _concurrencyLimiter = new SemaphoreSlim(_config.MaxConcurrentStreams);
    }

    public async Task<Image<Rgba32>> CreateCarrierImageAsync(Stream fileData, string fileName, CancellationToken cancellationToken = default)
    {
        // Check if we should use streaming based on configuration
        var shouldUseStreaming = _config.EnableStreaming && ShouldUseStreaming(fileData);
        
        if (!shouldUseStreaming)
        {
            Console.WriteLine($"Using fallback processor for file: {fileName}");
            StreamingMetrics.IncrementFallbackRequests();
            return await _fallbackProcessor.CreateCarrierImageAsync(fileData, fileName, cancellationToken);
        }

        // Try streaming with fallback
        await _concurrencyLimiter.WaitAsync(cancellationToken);
        try
        {
            Console.WriteLine($"Using streaming processor for file: {fileName}");
            StreamingMetrics.IncrementStreamingRequests();
            
            using var timeoutCts = new CancellationTokenSource(TimeSpan.FromSeconds(_config.StreamTimeoutSeconds));
            using var combinedCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, timeoutCts.Token);
            
            return await _streamingProcessor.CreateCarrierImageAsync(fileData, fileName, combinedCts.Token);
        }
        catch (Exception ex) when (_config.EnableFallback)
        {
            Console.WriteLine($"Streaming failed for {fileName}, falling back: {ex.Message}");
            StreamingMetrics.IncrementStreamingErrors();
            
            // Reset stream if possible
            if (fileData.CanSeek)
            {
                fileData.Position = 0;
            }
            
            return await _fallbackProcessor.CreateCarrierImageAsync(fileData, fileName, cancellationToken);
        }
        finally
        {
            _concurrencyLimiter.Release();
        }
    }

    public async Task<ExtractedFile> ExtractFileAsync(Stream imageStream, CancellationToken cancellationToken = default)
    {
        // Extraction uses the same logic for both processors
        try
        {
            return await _streamingProcessor.ExtractFileAsync(imageStream, cancellationToken);
        }
        catch (Exception ex) when (_config.EnableFallback)
        {
            Console.WriteLine($"Streaming extraction failed, falling back: {ex.Message}");
            
            // Reset stream if possible
            if (imageStream.CanSeek)
            {
                imageStream.Position = 0;
            }
            
            return await _fallbackProcessor.ExtractFileAsync(imageStream, cancellationToken);
        }
    }

    private bool ShouldUseStreaming(Stream fileData)
    {
        // Check memory pressure
        if (MemoryMonitor.IsMemoryPressureHigh())
        {
            Console.WriteLine("High memory pressure detected, using streaming");
            return true;
        }

        // Check file size if we can determine it
        if (fileData.CanSeek)
        {
            var fileSize = fileData.Length;
            return fileSize >= _config.StreamingThresholdBytes;
        }

        // Default to streaming if we can't determine size
        return true;
    }
}