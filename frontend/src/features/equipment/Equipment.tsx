import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useState } from "react";
import { type User } from "../../auth";
import { Alert } from "../../components/ui/alert";
import { Badge, statusVariant } from "../../components/ui/badge";
import { Card, CardContent } from "../../components/ui/card";
import { Input } from "../../components/ui/form-controls";
import { EmptyState, Page, PageHeader } from "../../components/ui/page";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { useDebounced } from "../../lib/hooks";
import { withOfflineFallback } from "../../lib/query";
import { type DataRow } from "../../lib/types";
import { api } from "../../offline/api";
import { cacheEquipment, searchCachedEquipment } from "../../offline/cache";

const SECTION_SCOPED = ["technician_st", "technician_pt", "technician_ct", "assistant_engineer", "engineer", "senior_engineer", "chief_engineer"];

export function Equipment({ user }: { user: User }) {
  const [search, setSearch] = useState("");
  const query = useDebounced(search.trim(), 200);
  const equipment = useQuery({
    queryKey: ["equipment", "list", query],
    queryFn: () => withOfflineFallback(
      async () => {
        const rows = await api<Array<DataRow & { id: string }>>(`/api/v1/equipment?search=${encodeURIComponent(query)}`);
        await cacheEquipment(rows);
        return rows as DataRow[];
      },
      () => searchCachedEquipment(query, SECTION_SCOPED.includes(user.role) ? user.section : undefined, 100),
    ),
  });
  const items = equipment.data?.data ?? [];

  return (
    <Page>
      <PageHeader eyebrow="Simulated asset registry" title="Equipment" description="Illustrative assets only; not connected to SAP or plant systems." />
      <div className="relative mb-3 w-full max-w-md">
        <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" />
        <Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search tag or name" aria-label="Search equipment" />
      </div>
      {equipment.data?.fromCache && <Alert variant="warning" className="mb-3">Offline: showing equipment cached on this device.</Alert>}
      {equipment.isError && <Alert variant="destructive" className="mb-3">Equipment could not be loaded.</Alert>}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Tag</TableHead><TableHead>Name</TableHead><TableHead>Station</TableHead><TableHead>Section</TableHead><TableHead>Criticality</TableHead><TableHead>Status</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={String(item.id)}>
                  <TableCell className="font-bold"><Link to={`/equipment/${encodeURIComponent(String(item.id))}`}>{String(item.tag)}</Link></TableCell>
                  <TableCell>{String(item.name)}</TableCell>
                  <TableCell>{String(item.station)}</TableCell>
                  <TableCell>{String(item.section)}</TableCell>
                  <TableCell><Badge variant={statusVariant(String(item.criticality))}>{String(item.criticality)}</Badge></TableCell>
                  <TableCell className="text-muted-foreground">{String(item.operational_status ?? "—")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {!equipment.isLoading && !items.length && <div className="mt-3"><EmptyState>No equipment matches this search.</EmptyState></div>}
    </Page>
  );
}
