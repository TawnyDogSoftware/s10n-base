import fs from "node:fs";

import type { AppSettings } from "@s10n-base/contracts";
import { nowIso } from "@s10n-base/shared/time";

const defaultSettings = (): AppSettings => ({
  defaultProjectSort: "updatedAt",
  showActivityFeed: true,
  compactSidebar: false,
  updatedAt: nowIso(),
});

export class SettingsService {
  constructor(private readonly filePath: string) {}

  get(): AppSettings {
    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as AppSettings;
      return parsed;
    } catch {
      const settings = defaultSettings();
      this.update(settings);
      return settings;
    }
  }

  update(settings: Omit<AppSettings, "updatedAt"> | AppSettings): AppSettings {
    const nextSettings: AppSettings = {
      ...settings,
      updatedAt: nowIso(),
    };

    fs.writeFileSync(this.filePath, JSON.stringify(nextSettings, null, 2));
    return nextSettings;
  }
}
