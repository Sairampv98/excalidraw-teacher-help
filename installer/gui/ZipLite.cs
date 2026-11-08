// A zip reader and a small zip writer for .NET 3.5 (Windows 7 has no ZipFile: that came with .NET 4.5).
// The reader takes a zip whose entries are stored or deflated (what every tool this setup carries is); a zip64 file
// (an entry or an archive of 4 GB or more) is refused with a plain message, not read wrong. The writer stores
// entries without compression and is for the setup's own tests.
//
// C# 3 (the compiler that ships with Windows 7).

using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Text;

namespace ExcalidrawClassroom
{
    internal sealed class ZipEntryInfo
    {
        public string Name;
        public int Method;
        public long CompressedSize;
        public long Size;
        public long HeaderOffset;
    }

    internal static class ZipLite
    {
        private const uint EndSignature = 0x06054b50;
        private const uint CentralSignature = 0x02014b50;
        private const uint LocalSignature = 0x04034b50;

        public static List<ZipEntryInfo> Entries(Stream zip)
        {
            // the end record is in the last 64 KB (a comment may follow it)
            long length = zip.Length;
            int tailLength = (int)Math.Min(length, 70000);
            byte[] tail = new byte[tailLength];
            zip.Position = length - tailLength;
            ReadFully(zip, tail, tailLength);

            int end = -1;
            for (int i = tailLength - 22; i >= 0; i--)
            {
                if (BitConverter.ToUInt32(tail, i) == EndSignature) { end = i; break; }
            }
            if (end < 0) throw new InvalidDataException("this is not a zip file (it has no end record)");

            int count = BitConverter.ToUInt16(tail, end + 10);
            long size = BitConverter.ToUInt32(tail, end + 12);
            long offset = BitConverter.ToUInt32(tail, end + 16);
            if (count == 0xFFFF || size == 0xFFFFFFFFL || offset == 0xFFFFFFFFL)
            {
                throw new InvalidDataException("this zip is larger than 4 GB (zip64), which this setup does not read");
            }

            zip.Position = offset;
            byte[] central = new byte[size];
            ReadFully(zip, central, central.Length);

            List<ZipEntryInfo> list = new List<ZipEntryInfo>();
            int p = 0;
            for (int n = 0; n < count; n++)
            {
                if (BitConverter.ToUInt32(central, p) != CentralSignature) throw new InvalidDataException("the zip's directory is damaged");
                ZipEntryInfo e = new ZipEntryInfo();
                e.Method = BitConverter.ToUInt16(central, p + 10);
                e.CompressedSize = BitConverter.ToUInt32(central, p + 20);
                e.Size = BitConverter.ToUInt32(central, p + 24);
                int nameLength = BitConverter.ToUInt16(central, p + 28);
                int extraLength = BitConverter.ToUInt16(central, p + 30);
                int commentLength = BitConverter.ToUInt16(central, p + 32);
                e.HeaderOffset = BitConverter.ToUInt32(central, p + 42);
                if (e.CompressedSize == 0xFFFFFFFFL || e.Size == 0xFFFFFFFFL || e.HeaderOffset == 0xFFFFFFFFL)
                {
                    throw new InvalidDataException("an entry of this zip is larger than 4 GB (zip64), which this setup does not read");
                }
                // bit 11 of the flags says the name is UTF-8; otherwise it is the old code page, which for the names here is ASCII
                bool utf8 = (BitConverter.ToUInt16(central, p + 8) & 0x800) != 0;
                e.Name = (utf8 ? Encoding.UTF8 : Encoding.GetEncoding(437)).GetString(central, p + 46, nameLength);
                list.Add(e);
                p += 46 + nameLength + extraLength + commentLength;
            }
            return list;
        }

        /// <summary>Writes one entry out to a file.</summary>
        public static void ExtractTo(Stream zip, ZipEntryInfo entry, string target)
        {
            zip.Position = entry.HeaderOffset;
            byte[] header = new byte[30];
            ReadFully(zip, header, 30);
            if (BitConverter.ToUInt32(header, 0) != LocalSignature) throw new InvalidDataException("the zip is damaged at " + entry.Name);
            int skip = BitConverter.ToUInt16(header, 26) + BitConverter.ToUInt16(header, 28);
            zip.Position = entry.HeaderOffset + 30 + skip;

            using (FileStream output = new FileStream(target, FileMode.Create, FileAccess.Write))
            {
                if (entry.Method == 0)
                {
                    Copy(zip, output, entry.CompressedSize);
                }
                else if (entry.Method == 8)
                {
                    // the compressed bytes only: a DeflateStream over a window of the file
                    using (Window window = new Window(zip, entry.CompressedSize))
                    using (DeflateStream inflate = new DeflateStream(window, CompressionMode.Decompress, true))
                    {
                        Copy(inflate, output, -1);
                    }
                }
                else
                {
                    throw new InvalidDataException(entry.Name + " is packed with a method this setup does not read (" + entry.Method + ")");
                }
            }
        }

        private static void Copy(Stream from, Stream to, long bytes)
        {
            byte[] buffer = new byte[256 * 1024];
            long left = bytes;
            while (left != 0)
            {
                int want = left < 0 ? buffer.Length : (int)Math.Min(buffer.Length, left);
                int n = from.Read(buffer, 0, want);
                if (n <= 0) break;
                to.Write(buffer, 0, n);
                if (left > 0) left -= n;
            }
        }

        private static void ReadFully(Stream s, byte[] buffer, int count)
        {
            int got = 0;
            while (got < count)
            {
                int n = s.Read(buffer, got, count - got);
                if (n <= 0) throw new EndOfStreamException("the zip ends too early");
                got += n;
            }
        }

        /// <summary>The next <c>length</c> bytes of a stream, as a stream of their own.</summary>
        private sealed class Window : Stream
        {
            private readonly Stream inner;
            private long left;

            public Window(Stream inner, long length) { this.inner = inner; left = length; }

            public override int Read(byte[] buffer, int offset, int count)
            {
                if (left <= 0) return 0;
                int n = inner.Read(buffer, offset, (int)Math.Min(count, left));
                left -= n;
                return n;
            }

            public override bool CanRead { get { return true; } }
            public override bool CanSeek { get { return false; } }
            public override bool CanWrite { get { return false; } }
            public override long Length { get { throw new NotSupportedException(); } }
            public override long Position { get { throw new NotSupportedException(); } set { throw new NotSupportedException(); } }
            public override void Flush() { }
            public override long Seek(long offset, SeekOrigin origin) { throw new NotSupportedException(); }
            public override void SetLength(long value) { throw new NotSupportedException(); }
            public override void Write(byte[] buffer, int offset, int count) { throw new NotSupportedException(); }
        }

        // ------------------------------------------------------------------------------------------------ writer

        private static uint[] table;

        private static uint Crc32(byte[] data)
        {
            if (table == null)
            {
                table = new uint[256];
                for (uint i = 0; i < 256; i++)
                {
                    uint c = i;
                    for (int k = 0; k < 8; k++) c = (c & 1) != 0 ? 0xEDB88320u ^ (c >> 1) : c >> 1;
                    table[i] = c;
                }
            }
            uint crc = 0xFFFFFFFFu;
            foreach (byte b in data) crc = table[(crc ^ b) & 0xFF] ^ (crc >> 8);
            return crc ^ 0xFFFFFFFFu;
        }

        /// <summary>Writes a zip of stored entries: names and their texts, in turn.</summary>
        public static void Write(string path, string[] names, string[] texts)
        {
            using (FileStream f = new FileStream(path, FileMode.Create, FileAccess.Write))
            using (BinaryWriter w = new BinaryWriter(f))
            {
                List<long> offsets = new List<long>();
                List<uint> crcs = new List<uint>();
                for (int i = 0; i < names.Length; i++)
                {
                    byte[] name = Encoding.UTF8.GetBytes(names[i]);
                    byte[] data = Encoding.UTF8.GetBytes(texts[i]);
                    uint crc = Crc32(data);
                    offsets.Add(f.Position);
                    crcs.Add(crc);
                    w.Write(LocalSignature); w.Write((ushort)20); w.Write((ushort)0x800); w.Write((ushort)0);
                    w.Write((ushort)0); w.Write((ushort)0x21); w.Write(crc); w.Write((uint)data.Length); w.Write((uint)data.Length);
                    w.Write((ushort)name.Length); w.Write((ushort)0); w.Write(name); w.Write(data);
                }
                long directory = f.Position;
                for (int i = 0; i < names.Length; i++)
                {
                    byte[] name = Encoding.UTF8.GetBytes(names[i]);
                    uint size = (uint)Encoding.UTF8.GetByteCount(texts[i]);
                    w.Write(CentralSignature); w.Write((ushort)20); w.Write((ushort)20); w.Write((ushort)0x800); w.Write((ushort)0);
                    w.Write((ushort)0); w.Write((ushort)0x21); w.Write(crcs[i]); w.Write(size); w.Write(size);
                    w.Write((ushort)name.Length); w.Write((ushort)0); w.Write((ushort)0); w.Write((ushort)0); w.Write((ushort)0);
                    w.Write((uint)0); w.Write((uint)offsets[i]); w.Write(name);
                }
                long directoryEnd = f.Position;
                w.Write(EndSignature); w.Write((ushort)0); w.Write((ushort)0); w.Write((ushort)names.Length); w.Write((ushort)names.Length);
                w.Write((uint)(directoryEnd - directory)); w.Write((uint)directory); w.Write((ushort)0);
            }
        }
    }
}
