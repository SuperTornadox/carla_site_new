"use client";

import { useEffect } from "react";

export default function BlogBodyClass({ className }: { className: string }) {
  useEffect(() => {
    const previous = document.body.className;
    document.body.className = className;
    return () => {
      document.body.className = previous;
    };
  }, [className]);

  return null;
}

