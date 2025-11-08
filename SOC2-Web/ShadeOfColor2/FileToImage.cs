using System;
﻿using System.Collections.Generic;
﻿using System.IO;
﻿using System.Security.Cryptography;
﻿using System.Text;
﻿using SixLabors.ImageSharp;
﻿using SixLabors.ImageSharp.PixelFormats;
﻿
﻿namespace ShadeOfColor
﻿{
﻿    public static class FileToImage
﻿    {
﻿        private const string SIGNATURE = "SC";
﻿        private const int SHA256_SIZE = 32;
﻿
﻿        public static string DecryptImageToFile(string inputImage, string outputPathOrDir)
﻿        {
﻿            using var image = Image.Load<Rgba32>(inputImage);
﻿
﻿            // Extract only RGB bytes, skipping the Alpha channel to avoid premultiplication issues.
﻿            var allBytesList = new List<byte>(image.Width * image.Height * 3);
﻿            for (int y = 0; y < image.Height; y++)
﻿            {
﻿                for (int x = 0; x < image.Width; x++)
﻿                {
﻿                    Rgba32 p = image[x, y];
﻿                    allBytesList.Add(p.R);
﻿                    allBytesList.Add(p.G);
﻿                    allBytesList.Add(p.B);
﻿                }
﻿            }
﻿            byte[] allBytes = allBytesList.ToArray();
﻿
﻿            // --- HEADER PARSING (JS COMPATIBLE) ---
﻿            int offset = 0;
﻿
﻿            // Signature (2 bytes)
﻿            string signature = Encoding.ASCII.GetString(allBytes, offset, 2);
﻿            offset += 2;
﻿            if (signature != SIGNATURE)
﻿                throw new Exception($"Invalid signature '{signature}'. Expected '{SIGNATURE}'. This is not a compatible file.");
﻿
﻿            // File size (8 bytes, little-endian)
﻿            long fileSize = BitConverter.ToInt64(allBytes, offset);
﻿            offset += 8;
﻿            if (fileSize < 0)
﻿                throw new Exception("Invalid file size in header.");
﻿
﻿            // Filename length (4 bytes, little-endian)
﻿            int fileNameLength = BitConverter.ToInt32(allBytes, offset);
﻿            offset += 4;
﻿            if (fileNameLength < 0 || fileNameLength > 2048) // Sanity check
﻿                throw new Exception("Invalid filename length in header.");
﻿
﻿            // Filename (variable length, UTF-8)
﻿            string embeddedName = Encoding.UTF8.GetString(allBytes, offset, fileNameLength);
﻿            offset += fileNameLength;
﻿
﻿            // IsEncrypted (1 byte)
﻿            bool isEncrypted = allBytes[offset] == 1;
﻿            offset += 1;
﻿            if (isEncrypted)
﻿            {
﻿                throw new NotSupportedException("Decryption is not supported in this version.");
﻿            }
﻿
﻿            // Padding
﻿            int padding = (4 - (offset % 4)) % 4;
﻿            offset += padding;
﻿
﻿            // SHA256 Hash (32 bytes)
﻿            byte[] sha256Stored = new byte[SHA256_SIZE];
﻿            Buffer.BlockCopy(allBytes, offset, sha256Stored, 0, SHA256_SIZE);
﻿            int dataOffset = offset + SHA256_SIZE;
﻿
﻿            if (dataOffset + fileSize > allBytes.Length)
﻿                throw new Exception("The image does not contain all the declared file data.");
﻿
﻿            byte[] fileData = new byte[fileSize];
﻿            Buffer.BlockCopy(allBytes, dataOffset, fileData, 0, (int)fileSize);
﻿
﻿            // Verify SHA256
﻿            using var sha256 = SHA256.Create();
﻿            byte[] sha256Calc = sha256.ComputeHash(fileData);
﻿            if (!BytesEqual(sha256Stored, sha256Calc))
﻿                throw new Exception("SHA256 hash mismatch: data is corrupted or has been altered.");
﻿
﻿            string outputPath = ResolveOutputPath(outputPathOrDir, embeddedName);
﻿            Directory.CreateDirectory(Path.GetDirectoryName(outputPath)!);
﻿            File.WriteAllBytes(outputPath, fileData);
﻿
﻿            return outputPath;
﻿        }
﻿
﻿        private static string ResolveOutputPath(string outputPathOrDir, string embeddedName)
﻿        {
﻿            bool endsWithSep =
﻿                outputPathOrDir.EndsWith(Path.DirectorySeparatorChar) ||
﻿                outputPathOrDir.EndsWith(Path.AltDirectorySeparatorChar);
﻿
﻿            if (endsWithSep || Directory.Exists(outputPathOrDir))
﻿            {
﻿                return Path.Combine(outputPathOrDir, embeddedName);
﻿            }
﻿            return outputPathOrDir;
﻿        }
﻿        
﻿        private static bool BytesEqual(byte[] a, byte[] b)
﻿        {
﻿            if (a == null || b == null || a.Length != b.Length) return false;
﻿            for (int i = 0; i < a.Length; i++)
﻿                if (a[i] != b[i]) return false;
﻿            return true;
﻿        }
﻿    }
﻿}
﻿