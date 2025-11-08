namespace ShadeOfColor2.Core.Services;

public static class MemoryMonitor
{
    private static readonly long MaxMemoryBytes = 200 * 1024 * 1024; // 200MB threshold
    
    public static bool IsMemoryPressureHigh()
    {
        GC.Collect(0, GCCollectionMode.Optimized);
        var memoryUsage = GC.GetTotalMemory(false);
        return memoryUsage > MaxMemoryBytes;
    }
    
    public static void ForceCleanup()
    {
        GC.Collect();
        GC.WaitForPendingFinalizers();
        GC.Collect();
    }
    
    public static long GetCurrentMemoryUsage()
    {
        return GC.GetTotalMemory(false);
    }
}