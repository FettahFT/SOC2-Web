using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;
using Microsoft.Extensions.Logging;

namespace ShadeOfColor2.Core.Services;

public class ResilientImageProcessor : IImageProcessor
{
    private readonly StreamingImageProcessor _streamingProcessor;
    private readonly ImageProcessor _fallbackProcessor;
    private readonly StreamingConfiguration _config;
    private readonly ILogger<ResilientImageProcessor> _logger;
    private readonly SemaphoreSlim _concurrencyLimiter;

    public ResilientImageProcessor(
        StreamingConfiguration config, 
        ILogger<ResilientImageProcessor> logger)
    {
        _streamingProcessor = new StreamingImageProcessor();
        _fallbackProcessor = new ImageProcessor();
        _config = config;
        _logger = logger;
        _concurrencyLimiter = new SemaphoreSlim(_config.MaxConcurrentStreams);
    }

    public async Task<Image<Rgba32>> CreateCarrierImageAsync(Stream fileData, string fileName, CancellationToken cancellationToken = default)
    {
        // Check if we should use streaming based on configuration
        var shouldUseStreaming = _config.EnableStreaming && ShouldUseStreaming(fileData);
        
        if (!shouldUseStreaming)
        {
            _logger.LogDebug("Using fallback processor for file: {FileName}", fileName);
            StreamingMetrics.IncrementFallbackRequests();
            return await _fallbackProcessor.CreateCarrierImageAsync(fileData, fileName, cancellationToken);
        }

        // Try streaming with fallback
        await _concurrencyLimiter.WaitAsync(cancellationToken);
        try
        {
            _logger.LogDebug("Using streaming processor for file: {FileName}", fileName);
            StreamingMetrics.IncrementStreamingRequests();
            
            using var timeoutCts = new CancellationTokenSource(TimeSpan.FromSeconds(_config.StreamTimeoutSeconds));
            using var combinedCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, timeoutCts.Token);
            
            return await _streamingProcessor.CreateCarrierImageAsync(fileData, fileName, combinedCts.Token);
        }
        catch (Exception ex) when (_config.EnableFallback)
        {
            _logger.LogWarning(ex, "Streaming failed for {FileName}, falling back to standard processing", fileName);
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
            _logger.LogWarning(ex, "Streaming extraction failed, falling back to standard processing");
            
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
            _logger.LogDebug("High memory pressure detected, using streaming");
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