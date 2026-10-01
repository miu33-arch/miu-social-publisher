import { runCustomsAudit } from '../docs/customsEngine.js';

export const customsToolSchema = {
  type: "function",
  function: {
    name: "verify_customs_compliance",
    description: "Extracts and standardizes shipping manifests, commercial invoices, and mill certificates for GCC customs clearance.",
    parameters: {
      type: "object",
      required: [
        "shipment_id",
        "origin_country",
        "destination_port",
        "consignee_type",
        "line_items"
      ],
      properties: {
        shipment_id: { type: "string" },
        origin_country: { type: "string", description: "ISO 2-letter country code" },
        destination_port: { type: "string", enum: ["SAJED", "SADMM", "SARUH"] },
        consignee_type: { type: "string", enum: ["COMMERCIAL", "INDUSTRIAL", "INDIVIDUAL"] },
        line_items: {
          type: "array",
          items: {
            type: "object",
            required: [
              "item_id",
              "commercial_description",
              "declared_hs_code",
              "quantity",
              "unit",
              "declared_value_cif_usd",
              "material_grade",
              "standard_specification",
              "marking_method"
            ],
            properties: {
              item_id: { type: "string" },
              commercial_description: { type: "string" },
              declared_hs_code: { type: "string" },
              quantity: { type: "number" },
              unit: { type: "string", enum: ["KG", "MT", "PCS", "M2"] },
              declared_value_cif_usd: { type: "number" },
              material_grade: { type: "string" },
              standard_specification: { type: "string" },
              marking_method: {
                type: "string",
                enum: ["ENGRAVED_ON_BODY", "EMBOSSED", "PRINTED_STICKER", "NONE"]
              }
            }
          }
        }
      }
    }
  }
};

const MINI_LLM_URL = process.env.MINI_LLM_ENDPOINT || "http://127.0.0.1:8000/v1/chat/completions";

export async function processCustomsManifest(documentText) {
  // 1. Invoke geMiu for structured parameter extraction
  const response = await fetch(MINI_LLM_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "geMiu",
      messages: [
        {
          role: "system",
          content: "You are geMiu, a deterministic logistics parsing agent. Extract line items, standards, markings, and customs data into the verify_customs_compliance tool format."
        },
        {
          role: "user",
          content: documentText
        }
      ],
      tools: [customsToolSchema],
      tool_choice: { type: "function", function: { name: "verify_customs_compliance" } }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Inference engine failed: ${errorText}`);
  }

  const result = await response.json();
  const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];

  if (!toolCall || toolCall.function.name !== "verify_customs_compliance") {
    throw new Error("Model failed to extract structured compliance parameters.");
  }

  const parsedPayload = JSON.parse(toolCall.function.arguments);

  // 2. Deterministic execution
  return runCustomsAudit(parsedPayload);
}