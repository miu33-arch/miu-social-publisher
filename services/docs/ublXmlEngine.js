import fs from "fs";
import path from "path";
import crypto from "crypto";

/**
 * Generates standard ZATCA Phase-2 UBL 2.1 XML structure
 */
export function generateZatcaUblXml({
  invoiceNumber,
  uuid,
  issueDate,
  issueTime,
  previousInvoiceHash = "NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjAzZTQ4MmUwNzM4MjRhNw==",
  seller = {
    crn: "1010899421",
    vatId: "310000000000003",
    street: "King Fahd Road",
    building: "7720",
    postalCode: "12214",
    city: "Riyadh",
    district: "Al-Olaya",
    legalName: "MIU SOVEREIGN DIGITAL ARCHITECT STUDIO"
  },
  buyer = {
    name: "AL-RAJHI COMMERCIAL CONTRACTING",
    vatId: "300000000000003",
    street: "King Abdulaziz Road",
    building: "1024",
    postalCode: "12345",
    city: "Riyadh",
    district: "Al-Malaz"
  },
  items = [],
  currency = "SAR",
  subtotal,
  vatAmount,
  grandTotal,
  outputsDir = "./outputs"
}) {
  const invUuid = uuid || crypto.randomUUID();
  const dateStr = issueDate || new Date().toISOString().split("T")[0];
  const timeStr = issueTime || new Date().toTimeString().split(" ")[0];

  const xmlItems = items.map((itm, idx) => `
    <cac:InvoiceLine>
        <cbc:ID>${idx + 1}</cbc:ID>
        <cbc:InvoicedQuantity unitCode="PCE">${itm.qty || 1}</cbc:InvoicedQuantity>
        <cbc:LineExtensionAmount currencyID="${currency}">${Number(itm.total || (itm.qty * itm.unitPrice)).toFixed(2)}</cbc:LineExtensionAmount>
        <cac:TaxTotal>
            <cbc:TaxAmount currencyID="${currency}">${Number((itm.total || (itm.qty * itm.unitPrice)) * 0.15).toFixed(2)}</cbc:TaxAmount>
            <cbc:RoundingAmount currencyID="${currency}">${(Number(itm.total || 0) * 1.15).toFixed(2)}</cbc:RoundingAmount>
        </cac:TaxTotal>
        <cac:Item>
            <cbc:Description>${itm.name || itm.code}</cbc:Description>
            <cbc:Name>${itm.name || itm.code}</cbc:Name>
            <cac:ClassifiedTaxCategory>
                <cbc:ID>S</cbc:ID>
                <cbc:Percent>15.00</cbc:Percent>
                <cac:TaxScheme>
                    <cbc:ID>VAT</cbc:ID>
                </cac:TaxScheme>
            </cac:ClassifiedTaxCategory>
        </cac:Item>
        <cac:Price>
            <cbc:PriceAmount currencyID="${currency}">${Number(itm.unitPrice).toFixed(2)}</cbc:PriceAmount>
        </cac:Price>
    </cac:InvoiceLine>
  `).join("");

  const ublXml = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
         xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">
    <cbc:ProfileID>reporting:1.0</cbc:ProfileID>
    <cbc:ID>${invoiceNumber}</cbc:ID>
    <cbc:UUID>${invUuid}</cbc:UUID>
    <cbc:IssueDate>${dateStr}</cbc:IssueDate>
    <cbc:IssueTime>${timeStr}</cbc:IssueTime>
    <cbc:InvoiceTypeCode name="0100000">388</cbc:InvoiceTypeCode>
    <cbc:DocumentCurrencyCode>${currency}</cbc:DocumentCurrencyCode>
    <cbc:TaxCurrencyCode>SAR</cbc:TaxCurrencyCode>
    <cac:AdditionalDocumentReference>
        <cbc:ID>ICV</cbc:ID>
        <cbc:UUID>1</cbc:UUID>
    </cac:AdditionalDocumentReference>
    <cac:AdditionalDocumentReference>
        <cbc:ID>PIH</cbc:ID>
        <cac:Attachment>
            <cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${previousInvoiceHash}</cbc:EmbeddedDocumentBinaryObject>
        </cac:Attachment>
    </cac:AdditionalDocumentReference>
    <cac:AccountingSupplierParty>
        <cac:Party>
            <cac:PartyIdentification>
                <cbc:ID schemeID="CRN">${seller.crn}</cbc:ID>
            </cac:PartyIdentification>
            <cac:PostalAddress>
                <cbc:StreetName>${seller.street}</cbc:StreetName>
                <cbc:BuildingNumber>${seller.building}</cbc:BuildingNumber>
                <cbc:CitySubdivisionName>${seller.district}</cbc:CitySubdivisionName>
                <cbc:CityName>${seller.city}</cbc:CityName>
                <cbc:PostalZone>${seller.postalCode}</cbc:PostalZone>
                <cac:Country>
                    <cbc:IdentificationCode>SA</cbc:IdentificationCode>
                </cac:Country>
            </cac:PostalAddress>
            <cac:PartyTaxScheme>
                <cbc:CompanyID>${seller.vatId}</cbc:CompanyID>
                <cac:TaxScheme>
                    <cbc:ID>VAT</cbc:ID>
                </cac:TaxScheme>
            </cac:PartyTaxScheme>
            <cac:PartyLegalEntity>
                <cbc:RegistrationName>${seller.legalName}</cbc:RegistrationName>
            </cac:PartyLegalEntity>
        </cac:Party>
    </cac:AccountingSupplierParty>
    <cac:AccountingCustomerParty>
        <cac:Party>
            <cac:PostalAddress>
                <cbc:StreetName>${buyer.street}</cbc:StreetName>
                <cbc:BuildingNumber>${buyer.building}</cbc:BuildingNumber>
                <cbc:CitySubdivisionName>${buyer.district}</cbc:CitySubdivisionName>
                <cbc:CityName>${buyer.city}</cbc:CityName>
                <cbc:PostalZone>${buyer.postalCode}</cbc:PostalZone>
                <cac:Country>
                    <cbc:IdentificationCode>SA</cbc:IdentificationCode>
                </cac:Country>
            </cac:PostalAddress>
            <cac:PartyTaxScheme>
                <cbc:CompanyID>${buyer.vatId}</cbc:CompanyID>
                <cac:TaxScheme>
                    <cbc:ID>VAT</cbc:ID>
                </cac:TaxScheme>
            </cac:PartyTaxScheme>
            <cac:PartyLegalEntity>
                <cbc:RegistrationName>${buyer.name}</cbc:RegistrationName>
            </cac:PartyLegalEntity>
        </cac:Party>
    </cac:AccountingCustomerParty>
    <cac:TaxTotal>
        <cbc:TaxAmount currencyID="${currency}">${Number(vatAmount).toFixed(2)}</cbc:TaxAmount>
        <cac:TaxSubtotal>
            <cbc:TaxableAmount currencyID="${currency}">${Number(subtotal).toFixed(2)}</cbc:TaxableAmount>
            <cbc:TaxAmount currencyID="${currency}">${Number(vatAmount).toFixed(2)}</cbc:TaxAmount>
            <cac:TaxCategory>
                <cbc:ID>S</cbc:ID>
                <cbc:Percent>15.00</cbc:Percent>
                <cac:TaxScheme>
                    <cbc:ID>VAT</cbc:ID>
                </cac:TaxScheme>
            </cac:TaxCategory>
        </cac:TaxSubtotal>
    </cac:TaxTotal>
    <cac:LegalMonetaryTotal>
        <cbc:LineExtensionAmount currencyID="${currency}">${Number(subtotal).toFixed(2)}</cbc:LineExtensionAmount>
        <cbc:TaxExclusiveAmount currencyID="${currency}">${Number(subtotal).toFixed(2)}</cbc:TaxExclusiveAmount>
        <cbc:TaxInclusiveAmount currencyID="${currency}">${Number(grandTotal).toFixed(2)}</cbc:TaxInclusiveAmount>
        <cbc:PayableAmount currencyID="${currency}">${Number(grandTotal).toFixed(2)}</cbc:PayableAmount>
    </cac:LegalMonetaryTotal>
    ${xmlItems}
</Invoice>`;

  const invoiceHash = crypto.createHash("sha256").update(ublXml).digest("base64");
  const fileName = `ubl_invoice_${invoiceNumber}_${Date.now()}.xml`;
  const xmlPath = path.resolve(outputsDir, fileName);

  fs.writeFileSync(xmlPath, ublXml, "utf-8");

  return {
    xmlPath,
    fileName,
    invoiceHash,
    uuid: invUuid,
    ublXml
  };
}