import type { PlasmoCSConfig } from "plasmo"

export const config: PlasmoCSConfig = {
  matches: ["https://linear.app/*"],
  run_at: "document_start"
}

import "../linear-content-main.js"
