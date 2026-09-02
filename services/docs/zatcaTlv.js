import QRCode from "qrcode";

/**
 * Builds a single TLV (Tag-Length-Value) buffer
 * Tag (1 byte) | Length (1 byte) | Value (UTF-8 bytes)
 */
function toTlvTag(tagNum, valStr) {
  const valueBuffer = Buffer.from(String(valStr || "").trim(), "utf8");
  const tagBuffer = Buffer.from([tagNum]);
  const lengthBuffer = Buffer.from([valueBuffer.length]);
  return Buffer.concat([tagBuffer, lengthBuffer, valueBuffer]);
}

/**
 * Generates official ZATCA Phase-2 compliant Base64 TLV string & QR Data URL
 */
export async function generateZatcaTlvQr({
  sellerName = "MIU STUDIO // SOVEREIGN CORE",
  vatNumber = "310000000000003",
  timestamp = new Date().toISOString(),
  invoiceTotal = "0.00",
  vatTotal = "0.00"
}) {
  const tag1 = toTlvTag(1, sellerName);
  const tag2 = toTlvTag(2, vatNumber);
  const tag3 = toTlvTag(3, timestamp);
  const tag4 = toTlvTag(4, Number(invoiceTotal).toFixed(2));
  const tag5 = toTlvTag(5, Number(vatTotal).toFixed(2));

  const tlvPayload = Buffer.concat([tag1, tag2, tag3, tag4, tag5]);
  const base64Tlv = tlvPayload.toString("base64");

  const qrDataUrl = await QRCode.toDataURL(base64Tlv, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 120,
    color: {
      dark: "#0f172a",
      light: "#ffffff"
    }
  });

  return { base64Tlv, qrDataUrl };
}