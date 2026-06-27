"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/* The app ships as a single self-contained index.html. To keep one source of
   truth, we pull the pure-logic block straight out of that file (between the
   "BEGIN/END testable logic" markers) and evaluate it in isolation. The tests
   therefore exercise the exact code that goes live. */
function loadLogic() {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const m = html.match(/=== BEGIN testable logic ===[\s\S]*?\*\/([\s\S]*?)\/\* === END testable logic ===/);
  if (!m) throw new Error("testable logic block not found in index.html");
  return new Function(
    m[1] + "\nreturn { getExifOrientation, needsFollowUp, missingFields, isRecordAbsent };"
  )();
}

const { missingFields, isRecordAbsent, needsFollowUp, getExifOrientation } = loadLogic();

/* ---------------- missingFields ---------------- */

test("missingFields: complete resident record has no gaps", () => {
  const r = { ownerName: "A", fatherHusbandName: "B", contact: "999" };
  assert.deepEqual(missingFields(r), []);
});

test("missingFields: resident reports the resident-specific fields", () => {
  assert.deepEqual(missingFields({}), [
    "Owner name", "Father/Husband name", "Phone number"
  ]);
});

test("missingFields: complete institution has no gaps", () => {
  const r = {
    isInstitution: true,
    organizationName: "Org", contactPerson: "P",
    designation: "Head", contact: "999"
  };
  assert.deepEqual(missingFields(r), []);
});

test("missingFields: institution uses the institution field set, not the resident one", () => {
  assert.deepEqual(missingFields({ isInstitution: true }), [
    "Organization name", "Contact person", "Designation", "Phone number"
  ]);
});

test("missingFields: reports only the genuinely missing fields", () => {
  const r = { ownerName: "A", contact: "" };
  assert.deepEqual(missingFields(r), ["Father/Husband name", "Phone number"]);
});

/* ---------------- isRecordAbsent ---------------- */

test("isRecordAbsent: trusts the stored boolean flag (true)", () => {
  assert.equal(isRecordAbsent({ isAbsent: true, ownerName: "A" }), true);
});

test("isRecordAbsent: trusts the stored boolean flag (false)", () => {
  assert.equal(isRecordAbsent({ isAbsent: false }), false);
});

test("isRecordAbsent: legacy institution without the flag is never absent", () => {
  assert.equal(isRecordAbsent({ isInstitution: true }), false);
});

test("isRecordAbsent: legacy resident without the flag is absent when no owner name", () => {
  assert.equal(isRecordAbsent({}), true);
  assert.equal(isRecordAbsent({ ownerName: "A" }), false);
});

/* ---------------- needsFollowUp ---------------- */

test("needsFollowUp: a complete present record needs nothing", () => {
  assert.equal(needsFollowUp({ isAbsent: false, needsCorrection: false }), false);
});

test("needsFollowUp: absent records need follow-up", () => {
  assert.equal(needsFollowUp({ isAbsent: true }), true);
});

test("needsFollowUp: admin-flagged corrections need follow-up even if present", () => {
  assert.equal(needsFollowUp({ isAbsent: false, needsCorrection: true }), true);
});

/* ---------------- getExifOrientation ---------------- */

/* Build a minimal JPEG containing an APP1/EXIF segment whose IFD0 has a
   single Orientation tag (0x0112) set to the given value. */
function makeJpegWithOrientation(orientation, little = true) {
  const buf = new ArrayBuffer(34);
  const v = new DataView(buf);
  v.setUint16(0, 0xFFD8, false);          // SOI
  v.setUint16(2, 0xFFE1, false);          // APP1 marker
  v.setUint16(4, 0x0000, false);          // segment length (parser ignores it for EXIF)
  v.setUint32(6, 0x45786966, false);      // "Exif"
  v.setUint16(10, 0x0000, false);         // "\0\0"
  // TIFF header begins at byte 12
  v.setUint16(12, little ? 0x4949 : 0x4D4D, false); // byte order ("II" / "MM")
  v.setUint16(14, 0x002A, little);        // TIFF magic
  v.setUint32(16, 8, little);             // offset to IFD0 (relative to TIFF start)
  // IFD0 at byte 20
  v.setUint16(20, 1, little);             // one directory entry
  v.setUint16(22, 0x0112, little);        // tag: Orientation
  v.setUint16(24, 3, little);             // type: SHORT
  v.setUint32(26, 1, little);             // count
  v.setUint16(30, orientation, little);   // value
  return buf;
}

test("getExifOrientation: reads a little-endian orientation tag", () => {
  assert.equal(getExifOrientation(makeJpegWithOrientation(6, true)), 6);
});

test("getExifOrientation: reads a big-endian orientation tag", () => {
  assert.equal(getExifOrientation(makeJpegWithOrientation(8, false)), 8);
});

test("getExifOrientation: normal orientation (1) round-trips", () => {
  assert.equal(getExifOrientation(makeJpegWithOrientation(1, true)), 1);
});

test("getExifOrientation: non-JPEG data falls back to 1", () => {
  const buf = new Uint8Array([0x89, 0x50, 0x4E, 0x47]).buffer; // PNG signature
  assert.equal(getExifOrientation(buf), 1);
});

test("getExifOrientation: a JPEG with no EXIF segment falls back to 1", () => {
  // SOI + APP0 (JFIF) segment of length 2, then nothing
  const buf = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x02]).buffer;
  assert.equal(getExifOrientation(buf), 1);
});

test("getExifOrientation: truncated/garbage buffer falls back to 1 without throwing", () => {
  assert.equal(getExifOrientation(new Uint8Array([0xFF, 0xD8]).buffer), 1);
  assert.equal(getExifOrientation(new ArrayBuffer(0)), 1);
});
