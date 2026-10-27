import { useEffect, useState } from "react";
import { isFeatureEnabled, setFeatureEnabled, type FeatureFlag } from "@/lib/featureFlags";

/** Hook تفاعلي لقراءة/تغيير حالة مفتاح ميزة. */
export function useFeatureFlag(flag: FeatureFlag): [boolean, (v: boolean) => void] {
  const [enabled, setEnabled] = useState<boolean>(() => isFeatureEnabled(flag));

  useEffect(() => {
    const sync = () => setEnabled(isFeatureEnabled(flag));
    const onCustom = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail || detail.flag === flag) sync();
    };
    window.addEventListener("feature-flag-changed", onCustom);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("feature-flag-changed", onCustom);
      window.removeEventListener("storage", sync);
    };
  }, [flag]);

  const update = (v: boolean) => {
    setFeatureEnabled(flag, v);
    setEnabled(v);
  };

  return [enabled, update];
}