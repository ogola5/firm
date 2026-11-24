import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { type User } from "../../auth";
import { api, isOfflineError } from "../../offline/api";
import { cacheEquipment, searchCachedEquipment } from "../../offline/cache";

export function Equipment({ user }: { user: User }) {
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [fromCache, setFromCache] = useState(false);
  useEffect(() => {
    const sectionScoped = ["technician_st", "technician_pt", "technician_ct", "assistant_engineer", "engineer", "senior_engineer", "chief_engineer"].includes(user.role);
    const timer = window.setTimeout(() => {
      api(`/api/v1/equipment?search=${encodeURIComponent(search)}`).then(async (rows) => {
        setItems(rows);
        setFromCache(false);
        await cacheEquipment(rows);
      }).catch(async (reason) => {
        if (!isOfflineError(reason)) return;
        setItems(await searchCachedEquipment(search, sectionScoped ? user.section : undefined, 100));
        setFromCache(true);
      });
    }, 200);
    return () => window.clearTimeout(timer);
  }, [search, user.role, user.section]);
  return (
    <section className="page">
      <div className="page-heading"><div><p className="eyebrow">SIMULATED ASSET REGISTRY</p><h2>Equipment</h2>{fromCache && <p className="muted">Offline: showing equipment cached on this device.</p>}</div></div>
      <div className="toolbar"><div className="search"><Search size={17} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tag or name" /></div></div>
      <div className="table panel"><table><thead><tr><th>Tag</th><th>Name</th><th>Station</th><th>Section</th><th>Criticality</th></tr></thead><tbody>{items.map((item) => <tr key={String(item.id)}><td><strong>{String(item.tag)}</strong></td><td>{String(item.name)}</td><td>{String(item.station)}</td><td>{String(item.section)}</td><td><span className="tag">{String(item.criticality)}</span></td></tr>)}</tbody></table></div>
    </section>
  );
}
