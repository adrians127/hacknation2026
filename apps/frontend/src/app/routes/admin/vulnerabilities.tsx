import { useTranslation } from "react-i18next";

import { PageHeader } from "@/components/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MappingsPanel } from "@/features/vulnerabilities/components/mappings-panel";
import { SourcesPanel } from "@/features/vulnerabilities/components/sources-panel";

export function VulnerabilitiesRoute() {
  const { t } = useTranslation("vulnerabilities");

  return (
    <div className="grid gap-6">
      <PageHeader title={t("sources.title")} description={t("sources.description")} />
      <Tabs defaultValue="sources">
        <TabsList>
          <TabsTrigger value="sources">{t("sources.title")}</TabsTrigger>
          <TabsTrigger value="mappings">{t("mappings.title")}</TabsTrigger>
        </TabsList>
        <TabsContent value="sources">
          <SourcesPanel />
        </TabsContent>
        <TabsContent value="mappings">
          <MappingsPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
