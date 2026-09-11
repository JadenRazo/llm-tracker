import { ImageResponse } from "next/og";

export const alt =
  "LLM Tracker: releases, models, and developer tools across Claude, OpenAI, and Gemini";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          width: "100%",
          height: "100%",
          padding: "64px 72px",
          background: "#111611",
          color: "#f2f3ea",
        }}
      >
        <div style={{ display: "flex", fontSize: 28, color: "#a8ce87" }}>
          LLM Tracker
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 76, lineHeight: 1.1, letterSpacing: -3 }}>
            A clearer view of what’s shipping.
          </div>
          <div style={{ fontSize: 28, color: "#cbd2c4" }}>
            Releases, models, and developer tools.
          </div>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            paddingTop: 24,
            borderTop: "1px solid #354030",
            fontSize: 23,
            color: "#a9b5a0",
          }}
        >
          <span>Claude · OpenAI · Gemini</span>
          <span>llm.raizhost.com</span>
        </div>
      </div>
    ),
    size,
  );
}
