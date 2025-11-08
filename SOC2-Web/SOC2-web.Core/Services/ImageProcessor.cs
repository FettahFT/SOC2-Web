using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;
using System.Security.Cryptography;

namespace ShadeOfColor2.Core.Services;

public interface IImageProcessor
{
    Task<Image<Rgba32>> CreateCarrierImageAsync(Stream fileData, string fileName, CancellationToken cancellationToken = default);
    Task<ExtractedFile> ExtractFileAsync(Stream imageStream, CancellationToken cancellationToken = default);
}

public record ExtractedFile(string FileName, byte[] Data, byte[] Sha256Hash);

public class ImageProcessor : IImageProcessor
{
    private const int BaseHeaderSize = 2 + 8 + 4;
    private const int MaxFileSize = 20 * 1024 * 1024;
    private const int MaxFilenameLength = 255;
    private const int Sha256HashSize = 32;
    private const int BytesPerPixel = 4;
    
    private readonly string _signature;
    
    public ImageProcessor()
    {
        _signature = "SC";
    }

    public async Task<Image<Rgba32>> CreateCarrierImageAsync(Stream fileData, string fileName, CancellationToken cancellationToken = default)
    {
        byte[] fileBytes;
        if (fileData is MemoryStream ms)
        {
            fileBytes = ms.ToArray();
        }
        else
        {
            using var tempStream = new MemoryStream();
            await fileData.CopyToAsync(tempStream, cancellationToken);
            fileBytes = tempStream.ToArray();
        }
        
        var fileSize = fileBytes.Length;
        
        if (fileSize > MaxFileSize)
            throw new ArgumentException($"File too large. Maximum size is {MaxFileSize / (1024 * 1024)}MB.");

        var sha256Hash = SHA256.HashData(fileBytes);
        
        var fileNameBytes = System.Text.Encoding.UTF8.GetBytes(fileName);
        if (fileNameBytes.Length > MaxFilenameLength)
            throw new ArgumentException($"Filename too long. Must be less than {MaxFilenameLength + 1} bytes.");

        var headerWithFilename = BaseHeaderSize + fileNameBytes.Length;
        var padding = (4 - (headerWithFilename % 4)) % 4;
        var totalHeaderSize = headerWithFilename + padding + Sha256HashSize;
        
        var totalDataSize = totalHeaderSize + fileSize;
        var pixelCount = (int)Math.Ceiling(totalDataSize / (double)BytesPerPixel);
        var imageSize = (int)Math.Ceiling(Math.Sqrt(pixelCount));

        var image = new Image<Rgba32>(imageSize, imageSize, Color.White);
        var pixelIndex = 0;

        WriteHeader(image, pixelIndex, fileSize, fileNameBytes, sha256Hash);
        pixelIndex += totalHeaderSize;

        WriteFileDataInChunks(image, pixelIndex, fileBytes);

        return image;
    }

    private void WriteHeader(Image<Rgba32> image, int startIndex, long fileSize, byte[] fileNameBytes, byte[] sha256Hash)
    {
        var currentSize = 2 + 8 + 4 + fileNameBytes.Length;
        var padding = (4 - (currentSize % 4)) % 4;
        var totalSize = currentSize + padding + Sha256HashSize;
        
        var bytes = new byte[totalSize];
        var offset = 0;
        
        var signatureBytes = System.Text.Encoding.ASCII.GetBytes(_signature);
        Array.Copy(signatureBytes, 0, bytes, offset, 2);
        offset += 2;
        
        var fileSizeBytes = BitConverter.GetBytes(fileSize);
        Array.Copy(fileSizeBytes, 0, bytes, offset, 8);
        offset += 8;
        
        var fileNameLengthBytes = BitConverter.GetBytes(fileNameBytes.Length);
        Array.Copy(fileNameLengthBytes, 0, bytes, offset, 4);
        offset += 4;
        
        Array.Copy(fileNameBytes, 0, bytes, offset, fileNameBytes.Length);
        offset += fileNameBytes.Length;
        
        offset += padding;
        
        Array.Copy(sha256Hash, 0, bytes, offset, Sha256HashSize);

        WriteBytesToImage(image, startIndex, bytes);
    }

    private void WriteFileDataInChunks(Image<Rgba32> image, int startIndex, byte[] fileData)
    {
        WriteBytesToImage(image, startIndex, fileData);
    }

    private void WriteBytesToImage(Image<Rgba32> image, int startIndex, byte[] data)
    {
        image.ProcessPixelRows(accessor =>
        {
            for (int i = 0; i < data.Length; i++)
            {
                var pixelIndex = startIndex + i;
                var pixelOffset = pixelIndex % 4;
                var pixelPosition = pixelIndex / 4;
                var row = pixelPosition / image.Width;
                var col = pixelPosition % image.Width;

                if (row >= image.Height) break;

                var pixelRow = accessor.GetRowSpan(row);
                var pixel = pixelRow[col];
                switch (pixelOffset)
                {
                    case 0: pixel.R = data[i]; break;
                    case 1: pixel.G = data[i]; break;
                    case 2: pixel.B = data[i]; break;
                    case 3: pixel.A = data[i]; break;
                }
                pixelRow[col] = pixel;
            }
        });
    }

    public async Task<ExtractedFile> ExtractFileAsync(Stream imageStream, CancellationToken cancellationToken = default)
    {
        try
        {
            if (imageStream.CanSeek && imageStream.Position != 0)
            {
                imageStream.Position = 0;
            }

            var image = await Image.LoadAsync<Rgba32>(imageStream, cancellationToken);

            var signatureBytes = ReadBytesFromImage(image, 0, 2);
            var signature = System.Text.Encoding.ASCII.GetString(signatureBytes);
            
            if (signature == "ER")
                return await ExtractFileFromOldFormatAsync(image, cancellationToken);
            
            if (signature != _signature)
                throw new InvalidDataException($"Invalid signature '{signature}'. This is not a ShadeOfColor2 encoded image.");

            var fileSizeBytes = ReadBytesFromImage(image, 2, 8);
            var fileSize = BitConverter.ToInt64(fileSizeBytes);

            var fileNameLengthBytes = ReadBytesFromImage(image, 10, 4);
            var fileNameLength = BitConverter.ToInt32(fileNameLengthBytes);

            var fileNameBytes = ReadBytesFromImage(image, 14, fileNameLength);
            var fileName = System.Text.Encoding.UTF8.GetString(fileNameBytes);

            var headerWithoutHash = 2 + 8 + 4 + fileNameLength;
            var sha256Offset = headerWithoutHash + (4 - (headerWithoutHash % 4)) % 4;

            var sha256Hash = ReadBytesFromImage(image, sha256Offset, Sha256HashSize);

            var fileDataOffset = sha256Offset + Sha256HashSize;
            var fileData = ReadBytesFromImage(image, fileDataOffset, (int)fileSize);

            var computedHash = SHA256.HashData(fileData);
            if (!computedHash.SequenceEqual(sha256Hash))
                throw new InvalidDataException("SHA256 hash mismatch. File may be corrupted.");

            return new ExtractedFile(fileName, fileData, sha256Hash);
        }
        catch (InvalidDataException)
        {
            throw;
        }
        catch (Exception ex)
        {
            throw new InvalidDataException($"Cannot read the uploaded file as an image. Please ensure you're uploading a valid PNG image created by this application. Error: {ex.Message}");
        }
    }

    private Task<ExtractedFile> ExtractFileFromOldFormatAsync(Image<Rgba32> image, CancellationToken cancellationToken)
    {
        const int OldFileNameFieldLength = 256;
        const int Sha1Length = 20;
        
        var fileSizeBytes = ReadBytesFromImage(image, 2, 8);
        var fileSize = BitConverter.ToInt64(fileSizeBytes);
        
        var fileNameBytes = ReadBytesFromImage(image, 10, OldFileNameFieldLength);
        var fileName = System.Text.Encoding.UTF8.GetString(fileNameBytes).TrimEnd('\0');
        
        var dataOffset = 2 + 8 + OldFileNameFieldLength + Sha1Length;
        var fileData = ReadBytesFromImage(image, dataOffset, (int)fileSize);
        
        var sha256Hash = SHA256.HashData(fileData);
        
        return Task.FromResult(new ExtractedFile(fileName, fileData, sha256Hash));
    }

    private byte[] ReadBytesFromImage(Image<Rgba32> image, int startIndex, int length)
    {
        var bytes = new byte[length];
        
        image.ProcessPixelRows(accessor =>
        {
            for (int i = 0; i < length; i++)
            {
                var pixelIndex = startIndex + i;
                var pixelOffset = pixelIndex % 4;
                var pixelPosition = pixelIndex / 4;
                var row = pixelPosition / image.Width;
                var col = pixelPosition % image.Width;

                if (row >= image.Height) break;

                var pixelRow = accessor.GetRowSpan(row);
                var pixel = pixelRow[col];
                bytes[i] = pixelOffset switch
                {
                    0 => pixel.R,
                    1 => pixel.G,
                    2 => pixel.B,
                    3 => pixel.A,
                    _ => 0
                };
            }
        });
        
        return bytes;
    }
}