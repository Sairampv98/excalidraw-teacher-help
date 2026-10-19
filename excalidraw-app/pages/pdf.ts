/**
 * A minimal multi-page PDF writer.
 *
 * Every page this app exports is a flat 1920x1080 raster, so a PDF page is
 * nothing more than one image XObject plus a content stream that draws it. That
 * is a small enough subset of PDF to write by hand, which is worth doing rather
 * than pulling in a PDF library: the writer is ~150 lines, has no dependencies,
 * and the output is a plain PDF any reader opens.
 *
 * Two image encodings are supported, in order of preference:
 *
 * - **Flate** — the raw pixels, deflated. Lossless, so text stays crisp. Uses
 *   the browser's own `CompressionStream`, which produces exactly the zlib
 *   wrapper PDF's `/FlateDecode` expects.
 * - **JPEG** — the fallback when `CompressionStream` is unavailable. Lossy, but
 *   universally supported and a fraction of the size.
 */

const encoder = new TextEncoder();

/** points per pixel at 96dpi, the CSS reference resolution */
const POINTS_PER_PIXEL = 0.75;

export type PdfPageImage = {
  /** pixel dimensions of the raster */
  width: number;
  height: number;
  /** either deflated raw RGB, or a JPEG file, depending on `filter` */
  data: Uint8Array;
  filter: "FlateDecode" | "DCTDecode";
};

export type BuildPdfOptions = {
  pages: PdfPageImage[];
  /** PDF page size in points; defaults to the first image's size at 96dpi */
  pageWidth?: number;
  pageHeight?: number;
};

const concat = (chunks: Uint8Array[]) => {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }

  return out;
};

const ascii = (value: string) => encoder.encode(value);

/** counts the bytes an object header occupies, so offsets stay correct */
class PdfWriter {
  private chunks: Uint8Array[] = [];
  private length = 0;
  private offsets: number[] = [];

  get position() {
    return this.length;
  }

  raw(data: Uint8Array | string) {
    const bytes = typeof data === "string" ? ascii(data) : data;

    this.chunks.push(bytes);
    this.length += bytes.length;
  }

  object(index: number, body: string, stream?: Uint8Array) {
    this.offsets[index] = this.length;
    this.raw(`${index} 0 obj\n${body}\n`);

    if (stream) {
      this.raw("stream\n");
      this.raw(stream);
      this.raw("\nendstream\n");
    }

    this.raw("endobj\n");
  }

  finish(objectCount: number, rootRef: string) {
    const xrefOffset = this.length;

    this.raw(`xref\n0 ${objectCount + 1}\n`);
    // the free head of the list, which every writer has to declare
    this.raw("0000000000 65535 f \n");

    for (let i = 1; i <= objectCount; i++) {
      this.raw(`${String(this.offsets[i] ?? 0).padStart(10, "0")} 00000 n \n`);
    }

    this.raw(
      `trailer\n<< /Size ${
        objectCount + 1
      } /Root ${rootRef} >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
    );

    return concat(this.chunks);
  }
}

/** RGBA pixels -> RGB, composited over white so a transparent page is not black */
const rgbaToRgb = (rgba: Uint8ClampedArray, pixelCount: number) => {
  const rgb = new Uint8Array(pixelCount * 3);

  for (let i = 0, j = 0; i < pixelCount * 4; i += 4, j += 3) {
    const alpha = rgba[i + 3] / 255;

    rgb[j] = Math.round(rgba[i] * alpha + 255 * (1 - alpha));
    rgb[j + 1] = Math.round(rgba[i + 1] * alpha + 255 * (1 - alpha));
    rgb[j + 2] = Math.round(rgba[i + 2] * alpha + 255 * (1 - alpha));
  }

  return rgb;
};

/** zlib-wrapped deflate, which is what `/FlateDecode` means */
const deflate = async (bytes: Uint8Array): Promise<Uint8Array | null> => {
  if (typeof CompressionStream === "undefined") {
    return null;
  }

  try {
    const stream = new Blob([bytes as BlobPart])
      .stream()
      .pipeThrough(new CompressionStream("deflate"));

    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
};

const dataUrlToBytes = async (dataUrl: string) =>
  new Uint8Array(await (await fetch(dataUrl)).arrayBuffer());

/**
 * Turns a rendered page canvas into an image XObject payload.
 *
 * Prefers lossless, falls back to JPEG when the platform cannot deflate.
 */
export const encodeCanvasForPdf = async (
  canvas: HTMLCanvasElement,
): Promise<PdfPageImage> => {
  const { width, height } = canvas;

  const context = canvas.getContext("2d");

  if (context) {
    const rgb = rgbaToRgb(
      context.getImageData(0, 0, width, height).data,
      width * height,
    );
    const compressed = await deflate(rgb);

    if (compressed) {
      return { width, height, data: compressed, filter: "FlateDecode" };
    }
  }

  return {
    width,
    height,
    data: await dataUrlToBytes(canvas.toDataURL("image/jpeg", 0.92)),
    filter: "DCTDecode",
  };
};

/**
 * Assembles the images into a PDF, one image per page.
 *
 * Object layout: 1 catalog, 2 page tree, then per page a page object, a content
 * stream and an image, in that order.
 */
export const buildPdf = ({
  pages,
  pageWidth,
  pageHeight,
}: BuildPdfOptions): Uint8Array => {
  if (!pages.length) {
    throw new Error("A PDF needs at least one page");
  }

  const width = pageWidth ?? pages[0].width * POINTS_PER_PIXEL;
  const height = pageHeight ?? pages[0].height * POINTS_PER_PIXEL;
  const count = pages.length;

  const firstPageObj = 3;
  const firstContentObj = firstPageObj + count;
  const firstImageObj = firstContentObj + count;
  const objectCount = firstImageObj + count - 1;

  const writer = new PdfWriter();

  writer.raw("%PDF-1.7\n%\xE2\xE3\xCF\xD3\n");

  writer.object(1, "<< /Type /Catalog /Pages 2 0 R >>");

  const kids = pages.map((_, index) => `${firstPageObj + index} 0 R`).join(" ");

  writer.object(2, `<< /Type /Pages /Count ${count} /Kids [${kids}] >>`);

  pages.forEach((image, index) => {
    writer.object(
      firstPageObj + index,
      `<< /Type /Page /Parent 2 0 R ` +
        `/MediaBox [0 0 ${width} ${height}] ` +
        `/Resources << /XObject << /Im0 ${firstImageObj + index} 0 R >> >> ` +
        `/Contents ${firstContentObj + index} 0 R >>`,
    );

    // content streams are short plain text, so they need no compression
    const content = ascii(`q\n${width} 0 0 ${height} 0 0 cm\n/Im0 Do\nQ\n`);

    writer.object(
      firstContentObj + index,
      `<< /Length ${content.length} >>`,
      content,
    );

    writer.object(
      firstImageObj + index,
      `<< /Type /XObject /Subtype /Image /Width ${image.width} ` +
        `/Height ${image.height} /ColorSpace /DeviceRGB ` +
        `/BitsPerComponent 8 /Filter /${image.filter} ` +
        `/Length ${image.data.length} >>`,
      image.data,
    );
  });

  return writer.finish(objectCount, "1 0 R");
};
