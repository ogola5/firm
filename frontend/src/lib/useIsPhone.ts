import { useEffect, useState } from "react";

/** Below Tailwind's `md` breakpoint (768 px): phones, where pages show one thing at a time. */
const QUERY = "(max-width: 767px)";

export function useIsPhone(): boolean {
  const [phone, setPhone] = useState(() => typeof window !== "undefined" && window.matchMedia?.(QUERY).matches);
  useEffect(() => {
    const media = window.matchMedia?.(QUERY);
    if (!media) return;
    const update = () => setPhone(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return Boolean(phone);
}
