"use client";
import { useEffect, useRef, useState } from "react";

export default function Form({ url }) {
  const ref = useRef(null); const [done, setDone] = useState(false);
  useEffect(() => { import("@docustay2026/embed"); const el = ref.current; const onDone = () => setDone(true); el?.addEventListener("completed", onDone); return () => el?.removeEventListener("completed", onDone); }, []);
  return done ? <p>Signed. Thank you.</p> : <docustay-sign ref={ref} url={url} height="720" />;
}
