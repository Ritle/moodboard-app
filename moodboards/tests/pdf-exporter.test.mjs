import assert from 'node:assert/strict';
import {
    calculateFixedPdfPlacement,
    createPdfFromJpeg,
    createPdfFromJpegs,
} from '../assets/js/editor/pdf-exporter.js';

const jpeg = (label) => new Blob([`fake-jpeg-${label}`], { type: 'image/jpeg' });
const readPdf = async (blob) => new TextDecoder('latin1').decode(await blob.arrayBuffer());

const singlePagePdf = await createPdfFromJpeg(jpeg('single'), {
    imageWidth: 1600,
    imageHeight: 1000,
});
const singlePageSource = await readPdf(singlePagePdf);
assert.equal(singlePagePdf.type, 'application/pdf');
assert.match(singlePageSource, /\/Count 1\b/);
assert.equal((singlePageSource.match(/\/Type \/Page\b/g) || []).length, 1);

assert.deepEqual(
    calculateFixedPdfPlacement({
        canvasWidth: 1600,
        canvasHeight: 1000,
        contentX: 100,
        contentY: 100,
        contentWidth: 400,
        contentHeight: 200,
    }),
    {
        page: { width: 842, height: 526.25 },
        x: 52.625,
        y: 368.375,
        width: 210.5,
        height: 105.25,
        scale: 0.52625,
    },
);

const fixedPagePdf = await createPdfFromJpeg(jpeg('fixed-layout'), {
    imageWidth: 800,
    imageHeight: 400,
    layout: {
        canvasWidth: 1600,
        canvasHeight: 1000,
        contentX: 100,
        contentY: 100,
        contentWidth: 400,
        contentHeight: 200,
    },
});
const fixedPageSource = await readPdf(fixedPagePdf);
assert.match(fixedPageSource, /\/MediaBox \[0 0 842 526\.25\]/);
assert.match(fixedPageSource, /210\.5 0 0 105\.25 52\.625 368\.375 cm/);

const overflowPlacement = calculateFixedPdfPlacement({
    canvasWidth: 1600,
    canvasHeight: 1000,
    contentX: -400,
    contentY: 0,
    contentWidth: 2400,
    contentHeight: 1000,
});
assert.equal(overflowPlacement.width, 842);
assert.equal(overflowPlacement.x, 0);
assert.ok(overflowPlacement.scale < 0.52625);

const multipagePdf = await createPdfFromJpegs([
    { jpegBlob: jpeg('landscape'), imageWidth: 1600, imageHeight: 1000 },
    { jpegBlob: jpeg('portrait'), imageWidth: 800, imageHeight: 1200 },
    { jpegBlob: jpeg('square'), imageWidth: 900, imageHeight: 900 },
]);
const multipageSource = await readPdf(multipagePdf);
assert.match(multipageSource, /\/Kids \[3 0 R 6 0 R 9 0 R\]/);
assert.match(multipageSource, /\/Count 3\b/);
assert.match(multipageSource, /\/Size 12\b/);
assert.equal((multipageSource.match(/\/Type \/Page\b/g) || []).length, 3);
assert.equal((multipageSource.match(/\/Subtype \/Image\b/g) || []).length, 3);

await assert.rejects(() => createPdfFromJpegs([]), /хотя бы один заполненный лист/);
await assert.rejects(
    () => createPdfFromJpegs([{ jpegBlob: jpeg('invalid'), imageWidth: 0, imageHeight: 100 }]),
    /корректные размеры/,
);

console.log('pdf-exporter tests passed');
