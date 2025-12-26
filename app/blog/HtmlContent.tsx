"use client";

import { useEffect, useRef } from "react";

interface HtmlContentProps {
  html: string;
  className?: string;
  id?: string;
}

export default function HtmlContent({ html, className, id }: HtmlContentProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.innerHTML = html;
    }
  }, [html]);

  // Start with empty div to avoid hydration mismatch, populate on client
  return <div ref={ref} id={id} className={className} />;
}
