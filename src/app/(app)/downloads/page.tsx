"use client";

import { DownloadCenter } from "@/components/payroll/documents/DownloadCenter";
import { DocsPage } from "@/components/payroll/documents/shared";

/** Download center (3.8 §4, §5.14): every signed-in user sees their own exports. */
export default function DownloadsPage() {
  return (
    <DocsPage>
      <DownloadCenter />
    </DocsPage>
  );
}
