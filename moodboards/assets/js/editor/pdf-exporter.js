const encoder = new TextEncoder();

function encode(value) {
    return encoder.encode(value);
}

function joinBytes(chunks) {
    const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
    const result = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }
    return result;
}

function formatPdfNumber(value) {
    return Number(value.toFixed(3)).toString();
}

function calculatePageSize(width, height) {
    const longestSide = 842;
    if (width >= height) {
        return {
            width: longestSide,
            height: longestSide * (height / width),
        };
    }
    return {
        width: longestSide * (width / height),
        height: longestSide,
    };
}

function createObject(id, body) {
    return encode(`${id} 0 obj\n${body}\nendobj\n`);
}

function normalizeFixedLayout(layout) {
    if (!layout || typeof layout !== 'object') {
        return null;
    }
    const values = {
        canvasWidth: Number(layout.canvasWidth),
        canvasHeight: Number(layout.canvasHeight),
        contentX: Number(layout.contentX),
        contentY: Number(layout.contentY),
        contentWidth: Number(layout.contentWidth),
        contentHeight: Number(layout.contentHeight),
    };
    if (
        !Object.values(values).every(Number.isFinite)
        || values.canvasWidth <= 0
        || values.canvasHeight <= 0
        || values.contentWidth <= 0
        || values.contentHeight <= 0
    ) {
        throw new TypeError('Для фиксированного экспорта PDF нужны корректные размеры холста и содержимого.');
    }
    return values;
}

export function calculateFixedPdfPlacement(layout) {
    const normalizedLayout = normalizeFixedLayout(layout);
    if (!normalizedLayout) {
        return null;
    }
    const page = calculatePageSize(normalizedLayout.canvasWidth, normalizedLayout.canvasHeight);
    const naturalScale = Math.min(
        page.width / normalizedLayout.canvasWidth,
        page.height / normalizedLayout.canvasHeight,
    );
    let scale = naturalScale;
    let width = normalizedLayout.contentWidth * scale;
    let height = normalizedLayout.contentHeight * scale;
    let x = normalizedLayout.contentX * scale;
    let y = page.height - (normalizedLayout.contentY + normalizedLayout.contentHeight) * scale;
    const fitsFixedPage = x >= 0
        && y >= 0
        && x + width <= page.width
        && y + height <= page.height;

    if (!fitsFixedPage) {
        scale = Math.min(
            naturalScale,
            page.width / normalizedLayout.contentWidth,
            page.height / normalizedLayout.contentHeight,
        );
        width = normalizedLayout.contentWidth * scale;
        height = normalizedLayout.contentHeight * scale;
        x = (page.width - width) / 2;
        y = (page.height - height) / 2;
    }

    return Object.freeze({ page, x, y, width, height, scale });
}

function normalizePdfPage(page, index) {
    const jpegBlob = page?.jpegBlob;
    if (!(jpegBlob instanceof Blob) || jpegBlob.size === 0) {
        throw new TypeError(`Для страницы PDF №${index + 1} нужен непустой JPEG Blob.`);
    }

    const normalizedWidth = Math.round(Number(page?.imageWidth));
    const normalizedHeight = Math.round(Number(page?.imageHeight));
    if (
        !Number.isFinite(normalizedWidth)
        || !Number.isFinite(normalizedHeight)
        || normalizedWidth <= 0
        || normalizedHeight <= 0
    ) {
        throw new TypeError(`Для страницы PDF №${index + 1} нужны корректные размеры изображения.`);
    }

    return {
        jpegBlob,
        imageWidth: normalizedWidth,
        imageHeight: normalizedHeight,
        layout: normalizeFixedLayout(page?.layout),
    };
}

export async function createPdfFromJpegs(pages) {
    if (!Array.isArray(pages) || pages.length === 0) {
        throw new TypeError('Для экспорта PDF нужен хотя бы один заполненный лист.');
    }

    const normalizedPages = pages.map(normalizePdfPage);
    const pageObjects = await Promise.all(normalizedPages.map(async (page, index) => {
        const jpegBytes = new Uint8Array(await page.jpegBlob.arrayBuffer());
        const fixedPlacement = calculateFixedPdfPlacement(page.layout);
        const pageSize = fixedPlacement?.page || calculatePageSize(page.imageWidth, page.imageHeight);
        const pageWidth = formatPdfNumber(pageSize.width);
        const pageHeight = formatPdfNumber(pageSize.height);
        const pageObjectId = 3 + index * 3;
        const contentObjectId = pageObjectId + 1;
        const imageObjectId = pageObjectId + 2;
        const imageName = `Im${index}`;
        const imagePlacement = fixedPlacement || {
            x: 0,
            y: 0,
            width: pageSize.width,
            height: pageSize.height,
        };
        const content = encode(
            `q\n${formatPdfNumber(imagePlacement.width)} 0 0 ${formatPdfNumber(imagePlacement.height)} ${formatPdfNumber(imagePlacement.x)} ${formatPdfNumber(imagePlacement.y)} cm\n/${imageName} Do\nQ\n`,
        );

        return {
            pageObjectId,
            objects: [
                createObject(
                    pageObjectId,
                    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /${imageName} ${imageObjectId} 0 R >> >> /Contents ${contentObjectId} 0 R >>`,
                ),
                joinBytes([
                    encode(`${contentObjectId} 0 obj\n<< /Length ${content.length} >>\nstream\n`),
                    content,
                    encode('endstream\nendobj\n'),
                ]),
                joinBytes([
                    encode(
                        `${imageObjectId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${page.imageWidth} /Height ${page.imageHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`,
                    ),
                    jpegBytes,
                    encode('\nendstream\nendobj\n'),
                ]),
            ],
        };
    }));

    const kids = pageObjects.map(({ pageObjectId }) => `${pageObjectId} 0 R`).join(' ');
    const objects = [
        createObject(1, '<< /Type /Catalog /Pages 2 0 R >>'),
        createObject(2, `<< /Type /Pages /Kids [${kids}] /Count ${pageObjects.length} >>`),
        ...pageObjects.flatMap(({ objects: pageEntries }) => pageEntries),
    ];

    const header = encode('%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n');
    const offsets = [];
    let byteOffset = header.length;
    for (const object of objects) {
        offsets.push(byteOffset);
        byteOffset += object.length;
    }

    const xrefOffset = byteOffset;
    const xrefRows = offsets
        .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
        .join('');
    const objectCount = objects.length + 1;
    const trailer = encode(
        `xref\n0 ${objectCount}\n0000000000 65535 f \n${xrefRows}trailer\n<< /Size ${objectCount} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
    );

    return new Blob([joinBytes([header, ...objects, trailer])], { type: 'application/pdf' });
}

export async function createPdfFromJpeg(jpegBlob, { imageWidth, imageHeight, layout = null } = {}) {
    return createPdfFromJpegs([{ jpegBlob, imageWidth, imageHeight, layout }]);
}
