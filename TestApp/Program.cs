using ShadeOfColor2.Core.Services;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;
using System.Security.Cryptography;

class Program
{
    static async Task Main(string[] args)
    {
        var processor = new ImageProcessor();

        // Create dummy files
        var testDir = Path.Combine(Directory.GetCurrentDirectory(), "test_files");
        Directory.CreateDirectory(testDir);

        var testFile = Path.Combine(testDir, "test.txt");
        await File.WriteAllTextAsync(testFile, "This is test data for steganography.");

        var encryptedImage = Path.Combine(testDir, "encrypted.png");
        var decryptedFile = Path.Combine(testDir, "decrypted.txt");

        Console.WriteLine("=== Testing ShadeOfColor2 ===");

        // Direct encrypt/decrypt test
        Console.WriteLine("\nDirect AES test:");
        var originalData = System.Text.Encoding.UTF8.GetBytes("Test data 123456");
        var encrypted = EncryptData(originalData, "testpass");
        Console.WriteLine($"Original: {originalData.Length} bytes, Encrypted: {encrypted.Length} bytes");
        var decrypted = DecryptData(encrypted, "testpass");
        Console.WriteLine($"Decrypted: {System.Text.Encoding.UTF8.GetString(decrypted)}");
        Console.WriteLine("Direct test passed.");

        // Test 1: Encrypt with password
        Console.WriteLine("\n1. Encrypting with password 'testpass'...");
        using (var fileStream = File.OpenRead(testFile))
        {
            var image = await processor.CreateCarrierImageAsync(fileStream, Path.GetFileName(testFile), "testpass");
            await image.SaveAsPngAsync(encryptedImage);
            Console.WriteLine("Encrypted image saved.");
        }

        // Test 2: Decrypt with correct password
        Console.WriteLine("\n2. Decrypting with correct password...");
        using (var imageStream = File.OpenRead(encryptedImage))
        {
            var extracted = await processor.ExtractFileAsync(imageStream, "testpass");
            await File.WriteAllBytesAsync(decryptedFile, extracted.Data);
            Console.WriteLine($"Decrypted file: {extracted.FileName}, Size: {extracted.Data.Length} bytes");
            Console.WriteLine("Content: " + System.Text.Encoding.UTF8.GetString(extracted.Data));
        }

        // Test 3: Try decrypt without password (should fail)
        Console.WriteLine("\n3. Trying to decrypt without password...");
        try
        {
            using (var imageStream = File.OpenRead(encryptedImage))
            {
                var extracted = await processor.ExtractFileAsync(imageStream, null);
                Console.WriteLine("ERROR: Should have failed!");
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine("Expected error: " + ex.Message);
        }

        // Test 4: Encrypt without password
        Console.WriteLine("\n4. Encrypting without password...");
        var noPassImage = Path.Combine(testDir, "no_pass.png");
        using (var fileStream = File.OpenRead(testFile))
        {
            var image = await processor.CreateCarrierImageAsync(fileStream, Path.GetFileName(testFile), null);
            await image.SaveAsPngAsync(noPassImage);
            Console.WriteLine("Unencrypted image saved.");
        }

        // Test 5: Decrypt unencrypted file
        Console.WriteLine("\n5. Decrypting unencrypted file...");
        var noPassDecrypted = Path.Combine(testDir, "no_pass_decrypted.txt");
        using (var imageStream = File.OpenRead(noPassImage))
        {
            var extracted = await processor.ExtractFileAsync(imageStream, null);
            await File.WriteAllBytesAsync(noPassDecrypted, extracted.Data);
            Console.WriteLine($"Decrypted file: {extracted.FileName}, Size: {extracted.Data.Length} bytes");
        }

        // Test 6: Wrong password
        Console.WriteLine("\n6. Trying wrong password...");
        try
        {
            using (var imageStream = File.OpenRead(encryptedImage))
            {
                var extracted = await processor.ExtractFileAsync(imageStream, "wrongpass");
                Console.WriteLine("ERROR: Should have failed!");
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine("Expected error: " + ex.Message);
        }

        Console.WriteLine("\n=== All tests completed ===");
    }

    private static byte[] EncryptData(byte[] data, string password)
    {
        var key = new Rfc2898DeriveBytes(password, new byte[16], 10000, HashAlgorithmName.SHA256).GetBytes(32);
        var iv = new byte[16];
        new Random().NextBytes(iv); // Random IV
        Console.WriteLine($"Encrypt Key: {Convert.ToHexString(key)}");
        Console.WriteLine($"Encrypt IV: {Convert.ToHexString(iv)}");

        using var aes = Aes.Create();
        aes.Key = key;
        aes.IV = iv;
        aes.Padding = PaddingMode.PKCS7;
        aes.Mode = CipherMode.CBC;

        var encrypted = aes.EncryptCbc(data, iv);
        Console.WriteLine($"Encrypted data: {Convert.ToHexString(encrypted)}");

        using var ms = new MemoryStream();
        ms.Write(iv, 0, iv.Length);
        ms.Write(encrypted, 0, encrypted.Length);
        Console.WriteLine($"Full encrypted: {Convert.ToHexString(ms.ToArray())}");
        return ms.ToArray();
    }

    private static byte[] DecryptData(byte[] data, string password)
    {
        var key = new Rfc2898DeriveBytes(password, new byte[16], 10000, HashAlgorithmName.SHA256).GetBytes(32);
        Console.WriteLine($"Decrypt Key: {Convert.ToHexString(key)}");

        var iv = new byte[16];
        Array.Copy(data, 0, iv, 0, 16);
        Console.WriteLine($"Decrypt IV: {Convert.ToHexString(iv)}");

        var encryptedData = data.Skip(16).ToArray();
        Console.WriteLine($"Encrypted data to decrypt: {Convert.ToHexString(encryptedData)}");

        using var aes = Aes.Create();
        aes.Key = key;
        aes.IV = iv;
        aes.Padding = PaddingMode.PKCS7;
        aes.Mode = CipherMode.CBC;

        var decrypted = aes.DecryptCbc(encryptedData, iv);
        return decrypted;
    }
}