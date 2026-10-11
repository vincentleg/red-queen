"use client";

import { useEffect, useState } from "react";

export function AtlasStatus() {
  const [status, setStatus] = useState<"checking" | "connected" | "unavailable">("checking");
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    fetch("/api/health", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        setStatus(response.ok && data.database === "connected" ? "connected" : "unavailable");
      })
      .catch(() => setStatus("unavailable"))
      .finally(() => clearTimeout(timeout));
    return () => { clearTimeout(timeout); controller.abort(); };
  }, []);
  return <span className={`atlas-status ${status}`} role="status"><i />ATLAS / {status.toUpperCase()}</span>;
}
