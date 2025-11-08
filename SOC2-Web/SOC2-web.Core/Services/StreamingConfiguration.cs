namespace ShadeOfColor2.Core.Services;

public class StreamingConfiguration
{
    public bool EnableStreaming { get; set; } = true;
    public int StreamingThresholdBytes { get; set; } = 5 * 1024 * 1024; // 5MB
    public int MaxStreamingFileSize { get; set; } = 100 * 1024 * 1024; // 100MB
    public int StreamTimeoutSeconds { get; set; } = 300; // 5 minutes
    public bool EnableFallback { get; set; } = true;
    public int MaxConcurrentStreams { get; set; } = 10;
}

public static class StreamingMetrics
{
    private static long _streamingRequests = 0;
    private static long _fallbackRequests = 0;
    private static long _streamingErrors = 0;
    
    public static void IncrementStreamingRequests() => Interlocked.Increment(ref _streamingRequests);
    public static void IncrementFallbackRequests() => Interlocked.Increment(ref _fallbackRequests);
    public static void IncrementStreamingErrors() => Interlocked.Increment(ref _streamingErrors);
    
    public static (long Streaming, long Fallback, long Errors) GetMetrics() => 
        (_streamingRequests, _fallbackRequests, _streamingErrors);
}