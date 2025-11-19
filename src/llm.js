import OpenAI from "openai";
import { z } from "zod";
import 'dotenv/config';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

import { retrieveSimilar } from "./rag.js";

// --- NEW: classify product + intent in one shot ----------------------
//actually intent not rly used anymore cos of the checklist so idk if wanna keep the intent here hmhmm...
export async function classifyProductAndIntent(emailText) {
  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `Return ONLY valid JSON with this shape:
                  {"product":"stickers"|"namecards"|"both"|"other","intent":"quote_payment"|"general","confidence":0..1}

                  Definitions:
                  - product:
                    - "stickers": stickers/labels/decals, kiss-cut, die-cut, sheets, A4/A3, PP/PVC/Mirrorkote, etc.
                    - "namecards": business/name cards, 88x54/90x54, 1-side/2-side, 300gsm, linen, majestic, etc.
                    - "both": stickers/labels/decals, kiss-cut, die-cut, sheets, A4/A3, PP/PVC/Mirrorkote AND business/name cards, 88x54/90x54, 1-side/2-side, 300gsm, linen, majestic, etc
                    - "other": anything else (flyers, posters, greetings, vague).
                  - intent:
                    - "quote_payment": explicitly asking for price/quote/estimate/budget.
                    - "general": everything else (lead time, artwork specs w/o price ask, shipping, payment, hello, etc).

                  Rules:
                  - If price words ("price","quote","quotation","how much","cost","estimate","budget") appear with relevant product signals, choose "quote_payment".
                  - If only specs (size/material/qty) but NO price ask, choose "general".
                  - If quantity/material/size is NOT mentioned, classify "general". And ask for missing infomation.
                  - ONLY choose "both" if there is ONLY BOTH STICKER AND NAMECARDS.
                  - Be deterministic. Temperature zero.
        `.trim()
      },
      {   
        role: "user",
        content: `
          The message below contains TWO sections:
          1. "Textbox Input" — provided manually by the customer or staff. This is always the most accurate and up-to-date information. Prioritize this section for classification.
          2. "Extracted PDF Text" — automatically parsed from an attached file. Use only as secondary reference.

          Always prioritize and trust the "Textbox Input" over the PDF text if they conflict.

          --- Start of content ---
          ${emailText}
          --- End of content ---
        `.trim() 
      }
    ],
    response_format: { type: "json_object" },
    temperature: 0
  });

  return JSON.parse(res.choices[0].message.content);
}

// ---- extract fields -> returns a JS object
export async function extractQuoteFields(emailText) {
  const sysPrompt = `
    Extract strict JSON only. Convert all units to mm.
    Keys:
      width_mm (int),
      height_mm (int),
      quantity_expr (string),
      shape (round|rect-straight|rect-rounded|square-straight|square-rounded|oval|custom),
      material (Mirrorkote | Synthetic | Synthetic (Transparent) | PVC (White-base) | PVC (Transparent) | Removable Synthetic | Removable PVC (White-base) | Removable PVC (Transparent) | Silver Synthetic | Silver PVC | Hologram Synthetic | Hologram PVC),
      material_variants (string[], optional),   // e.g. ["Mirrorkote","Synthetic"] when user says "mirrorkote and synthetic"
      size_variants (array of {width_mm:int,height_mm:int}, optional), // if user lists multiple sizes
      shape_variants (string[], optional), // e.g. ["round","square-straight"]
      cut_type ("none"|"individual-cut"|"die-cut", default "none"),
      design_count (int, default 1).
      customer_name (string, optional).
      usage_known (boolean, optional),
      usage_purpose (string, optional),
      distribution_known (boolean, optional),
      distribution_mode ("peel_and_paste"|"distribute", optional),
      material_known (boolean, optional).
    Rules for cut_type:
      NEVER infer. Set to "individual-cut" only if the email explicitly says phrases like
      "individual cut", "individually cut", "separate pieces", "loose pieces", or "each sticker loose".
      Set to "die-cut" only if the email explicitly says "die cut" or "die-cut" ONLY.
      Otherwise ALWAYS "none".
      If stated "Kiss-cut" or "kiss cut" set cut type to "none".
    Rules for design_count:
      - Detect how many different designs the customer is requesting for the *same shape/material*.
      - If they say things like "2 designs", "3 versions" but same material and size -> set design_count accordingly.
      - If they mention somthing like "2 stickers but same material and size" -> that means 2 designs.
      - Default is 1.
    Normalize synonyms to the enum:
      * "round","circle","circular" -> "round"
      * "square" -> "square-straight" (unless "rounded corners" is stated)
      * "square with rounded corners","rounded square" -> "square-rounded"
      * "rectangle" -> "rect-straight" (unless "rounded corners" is stated)
      * "rounded rectangle","rectangle with rounded corners" -> "rect-rounded"
      * "oval" -> "oval"
      * "custom","irregular","die cut to shape" (when unspecified) -> "custom"
    Variant rules:
      - If multiple MATERIALS are requested (e.g., "mirrorkote and synthetic"), put them in material_variants.
      - If multiple SIZES are requested, put them in size_variants.
      - If multiple shapes are mentioned (e.g., "round and square"), set 'shape' to the first mentioned, and put ALL mentioned (normalized) shapes in 'shape_variants'.
      - Do NOT produce a cross-product; listing both is okay, caller will choose one axis to fan out.
    Usage/Distribution/Material rules:
      - If the email states how/where the stickers are used, set usage_known=true and summarize in usage_purpose (short phrase, e.g., "for bottles", "outdoor on glass").
      - If the email states distribution mode (e.g., "we will peel and paste", "we distribute to customers"), set distribution_known=true and distribution_mode to "peel_and_paste" or "distribute".
      - If a material requirement is clearly stated (e.g., waterproof, PVC, removable), set material_known=true; otherwise false.
    Output: ONLY the JSON object with the keys above.
 `;

  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: sysPrompt },
      { role: "user",
        content: `
          The message below contains TWO sections:
          1. "Textbox Input" — provided manually by the customer or staff. This is always the most accurate and up-to-date information. Prioritize this section for classification.
          2. "Extracted PDF Text" — automatically parsed from an attached file. Use only as secondary reference.

          Always prioritize and trust the "Textbox Input" over the PDF text if they conflict.

          --- Start of content ---
          ${emailText}
          --- End of content ---
        `.trim()
      }
    ],
    response_format: { type: "json_object" },
    temperature: 0
  });

  try {
    return JSON.parse(res.choices[0].message.content);
  } catch {
    return {
      width_mm: 50,
      height_mm: 50,
      quantity_expr: "100",
      shape: "rect-rounded",
      material: "mirrorkote"
    };
  }
}

// ---- compose answer -> returns a plain string
export async function composeAnswer(emailText, retrievedSnippets) {
  const systemPrompt = `
    You are a helpful print shop assistant.
    Answer the customer using ONLY the provided context snippets.
    However, you should be equipped with general and in-house knowledge sourced from the emails.
    If the context does not contain enough information, ask up to 2 clarifying questions.
    Be concise, polite, and professional as far as possible, unless otherwise commanded.
    Format the answer as plain text that can go directly into an email body with correct paragraphs.
    dont restate the order details, instead give suggestion on the material and how it is beneficial if nessary.
    dont give sticker material suggesting if the order is for namecards. instead you can state the size of the namecards or any other relevant information from the website.
    if there is missing information(only for shape, size, material) ask for them.
    we do not provide vinyl stickers, only mirrorkote, synthetic or white PVC. or anything else in the retrievedSnippets.
    dont add best regards or signature at the end.
    dont add Hi xxx or Dear xxx.`

  const contextBlock = (retrievedSnippets || []).map((s) => `- ${s}`).join("\n");

  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Customer email:\n${emailText}\n\nContext:\n${contextBlock}` }
    ],
    temperature: 0.4
  });

  return res.choices[0].message.content.trim();
}


// ---- compose answer -> returns a plain string
export async function composeAnswerforOthers(emailText, retrievedSnippets, opts = {}) {
  const extra = String(opts.styleNotes || "").slice(0, 600); // cap length
  const systemPrompt = `
    You are a helpful print shop assistant.
    Answer the customer.
    However, you should be equipped with general and in-house knowledge sourced from the emails.
    If the context does not contain enough information, ask up to 2 clarifying questions.
    Be concise, polite, and professional as far as possible, unless otherwise commanded.
    Format the answer as plain text that can go directly into an email body.
    if asked can print on sheet or roll, say that we only can print on sheet
    dont add best regards or signature at the end.
    dont add Hi xxx or Dear xxx.
    ${extra ? `\nAdditional prompts to follow (very important):
      you are still the shop assistant. these are new instructions given to you. ${extra}\n` : ""},
  `;
  console.log(extra);

  const contextBlock = (retrievedSnippets || []).map((s) => `- ${s}`).join("\n");

  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Customer email:\n${emailText}\n\nContext:\n${contextBlock}` }
    ],
    temperature: 0.4
  });

  return res.choices[0].message.content.trim();
}

export async function findLatestAddr(emailText) {
  const systemPrompt = `
    Extract the latest shipping address mentioned by the customer.
    Return ONLY valid JSON with this exact shape:
    {
      "AddressName": string,
      "AddressStreet": string,
      "AddressUnit": string,
      "AddressPostalCode": string,
      "customerName": string,
      "customerNumber": string
    }

    Rules:
    - If some info is missing, still include the key but use an empty string ("").
    - AddressName can be company name or recipient name.
    - customerNumber can be mobile or phone number in any format.
    - DO NOT add any text outside JSON.
  `;
  
  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user",
        content: `
          The message below contains TWO sections:
          1. "Textbox Input" — provided manually by the customer or staff. This is always the most accurate and up-to-date information. Prioritize this section for classification.
          2. "Extracted PDF Text" — automatically parsed from an attached file. Use only as secondary reference.

          Always prioritize and trust the "Textbox Input" over the PDF text if they conflict.

          --- Start of content ---
          ${emailText}
          --- End of content ---
        `.trim() 
      }
    ],
    response_format: { type: "json_object" },
    temperature: 0.2
  });
  // console.log( res.choices[0].message.content.trim());
  // return res.choices[0].message.content.trim();
  const parsed = JSON.parse(res.choices[0].message.content.trim());
  console.log("✅ Parsed address:", parsed);
  return parsed;
}