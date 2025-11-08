using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;
using SixLabors.ImageSharp.Formats.Png;

namespace ShadeOfColor2.Core.Services;

public static class StreamingResponseHandler
{
    public static async Task StreamImageToPngAsync(Image<Rgba32> image, Stream outputStream, CancellationToken cancellationToken = default)
    {
        var encoder = new PngEncoder
        {
            CompressionLevel = PngCompressionLevel.DefaultCompression,
            ColorType = PngColorType.RgbWithAlpha
        };
        
        await image.SaveAsync(outputStream, encoder, cancellationToken);
    }
    
    public static IResult CreateStreamingFileResult(byte[] fileData, string contentType, string fileName)
    {
        var stream = new MemoryStream(fileData);
        return Results.Stream(stream, contentType, fileName, enableRangeProcessing: false);
    }
}