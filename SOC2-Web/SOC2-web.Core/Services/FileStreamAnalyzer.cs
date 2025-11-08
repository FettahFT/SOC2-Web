using System.Security.Cryptography;

namespace ShadeOfColor2.Core.Services;

public record FileAnalysisResult(long Size, byte[] Sha256Hash, Stream ResetStream);

public class FileStreamAnalyzer
{
    private const int BufferSize = 64 * 1024; // 64KB buffer

    public static async Task<FileAnalysisResult> AnalyzeAsync(Stream stream, CancellationToken cancellationToken = default)
    {
        var buffer = new byte[BufferSize];
        long totalSize = 0;
        
        using var sha256 = SHA256.Create();
        
        // If stream is seekable, we can reset it later
        var canReset = stream.CanSeek;
        var originalPosition = canReset ? stream.Position : 0;
        
        int bytesRead;
        while ((bytesRead = await stream.ReadAsync(buffer, 0, BufferSize, cancellationToken)) > 0)
        {
            totalSize += bytesRead;
            sha256.TransformBlock(buffer, 0, bytesRead, null, 0);
        }
        
        sha256.TransformFinalBlock(Array.Empty<byte>(), 0, 0);
        var hash = sha256.Hash!;
        
        // Reset stream if possible
        if (canReset)
        {
            stream.Position = originalPosition;
        }
        
        return new FileAnalysisResult(totalSize, hash, stream);
    }
}