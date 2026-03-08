import { useMemo, useState } from 'react';
import { Bookmark, Pencil, Star, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '../../features/auth/auth.store.js';
import { loadSavedFilterViews, paramsToSearchParams, sanitizeSearchParams, saveSavedFilterViews, serializeSavedParams, type SavedFilterView } from '../../lib/filters/saved-filters.js';
import { Badge } from '../ui/badge.js';
import { Button } from '../ui/button.js';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog.js';
import { Input } from '../ui/input.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select.js';

type Props = {
  moduleKey: string;
  currentParams: URLSearchParams;
  paginationKeys?: string[];
  onApply: (params: URLSearchParams) => void;
};

export function SavedFiltersBar(props: Props) {
  const claims = useAuthStore((state) => state.claims);
  const adminId = claims?.adminId;
  const paginationKeys = useMemo(() => props.paginationKeys ?? ['page'], [props.paginationKeys]);
  const [storageVersion, setStorageVersion] = useState(0);
  const [selectedViewId, setSelectedViewId] = useState<string>('');
  const [saveOpen, setSaveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [draftName, setDraftName] = useState('');

  const views = useMemo(() => {
    void storageVersion;
    return adminId ? loadSavedFilterViews(adminId, props.moduleKey) : [];
  }, [adminId, props.moduleKey, storageVersion]);

  const currentSnapshot = useMemo(() => sanitizeSearchParams(props.currentParams, paginationKeys), [props.currentParams, paginationKeys]);
  const currentSerialized = useMemo(() => serializeSavedParams(currentSnapshot), [currentSnapshot]);
  const activeView = useMemo(() => views.find((view) => serializeSavedParams(view.params) === currentSerialized) ?? null, [views, currentSerialized]);
  const resolvedSelectedViewId = views.some((view) => view.id === selectedViewId) ? selectedViewId : activeView?.id ?? '';
  const selectedView = useMemo(() => views.find((view) => view.id === resolvedSelectedViewId) ?? activeView ?? null, [views, resolvedSelectedViewId, activeView]);
  const defaultView = useMemo(() => views.find((view) => view.isDefault) ?? null, [views]);
  const hasFilters = Object.keys(currentSnapshot).length > 0;

  function normalizeName(value: string) {
    return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  }

  function persist(next: SavedFilterView[]) {
    if (!adminId) return;
    saveSavedFilterViews(adminId, props.moduleKey, next);
    setStorageVersion((value) => value + 1);
  }

  function applyView(view: SavedFilterView) {
    setSelectedViewId(view.id);
    props.onApply(paramsToSearchParams(view.params, paginationKeys));
    toast.success(`Applied "${view.name}"`);
  }

  function createView() {
    if (!adminId) return;
    const name = draftName.trim();
    if (!name) {
      toast.error('Saved filter name is required');
      return;
    }
    const duplicateName = views.find((view) => normalizeName(view.name) === normalizeName(name));
    if (duplicateName) {
      toast.error(`"${duplicateName.name}" already exists. Select it and use Update instead.`);
      return;
    }
    const nextView: SavedFilterView = {
      id: crypto.randomUUID(),
      name,
      params: currentSnapshot,
      isDefault: false,
      updatedAt: new Date().toISOString()
    };
    persist([nextView, ...views.filter((view) => serializeSavedParams(view.params) !== currentSerialized)]);
    setSelectedViewId(nextView.id);
    setDraftName('');
    setSaveOpen(false);
    toast.success(`Saved "${name}"`);
  }

  function updateActiveView() {
    if (!selectedView) return;
    const next = views.map((view) =>
      view.id === selectedView.id ? { ...view, params: currentSnapshot, updatedAt: new Date().toISOString() } : view
    );
    persist(next);
    toast.success(`Updated "${selectedView.name}"`);
  }

  function toggleDefault() {
    if (!selectedView) return;
    const previousDefault = defaultView && defaultView.id !== selectedView.id ? defaultView : null;
    const next = views.map((view) => ({
      ...view,
      isDefault: view.id === selectedView.id ? !view.isDefault : false
    }));
    persist(next);
    if (selectedView.isDefault) {
      toast.success('Default view removed');
      return;
    }
    toast.success(
      previousDefault
        ? `Default changed from "${previousDefault.name}" to "${selectedView.name}"`
        : `Default set to "${selectedView.name}"`
    );
  }

  function deleteActiveView() {
    if (!selectedView) return;
    const deletedName = selectedView.name;
    const deletingActiveView = activeView?.id === selectedView.id;
    persist(views.filter((view) => view.id !== selectedView.id));
    setSelectedViewId('');
    setDeleteOpen(false);
    toast.success(deletingActiveView ? `Deleted "${deletedName}". Current filters stay applied.` : `Deleted "${deletedName}"`);
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border/70 bg-muted/20 p-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:items-center">
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
          <Bookmark className="h-3.5 w-3.5" />
          Saved filters
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Select value={resolvedSelectedViewId || undefined} onValueChange={(value) => {
            setSelectedViewId(value);
            const view = views.find((item) => item.id === value);
            if (view) applyView(view);
          }}>
            <SelectTrigger className="w-full min-w-[220px] lg:w-[260px]">
              <SelectValue placeholder="Choose a saved view" />
            </SelectTrigger>
            <SelectContent>
              {views.map((view) => (
                <SelectItem key={view.id} value={view.id}>
                  {view.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {defaultView ? <Badge variant="warning">Default: {defaultView.name}</Badge> : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => setSaveOpen(true)} disabled={!hasFilters}>
          Save current
        </Button>
        <Button variant="secondary" size="sm" onClick={updateActiveView} disabled={!selectedView}>
          <Pencil className="mr-2 h-3.5 w-3.5" />
          Update
        </Button>
        <Button variant="secondary" size="sm" onClick={toggleDefault} disabled={!selectedView}>
          <Star className="mr-2 h-3.5 w-3.5" />
          {selectedView?.isDefault ? 'Unset default' : 'Set default'}
        </Button>
        <Button variant="secondary" size="sm" onClick={() => defaultView && applyView(defaultView)} disabled={!defaultView}>
          Use default
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setDeleteOpen(true)} disabled={!selectedView}>
          <Trash2 className="mr-2 h-3.5 w-3.5" />
          Delete
        </Button>
      </div>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save current filter set</DialogTitle>
            <DialogDescription>Create a private saved view for this admin account.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Input value={draftName} onChange={(event) => setDraftName(event.currentTarget.value)} placeholder="e.g. Orders pending dispatch" />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setSaveOpen(false)}>
              Cancel
            </Button>
            <Button onClick={createView}>Save view</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete saved filter?</DialogTitle>
            <DialogDescription>{selectedView ? `"${selectedView.name}" will be removed for this admin account.` : 'No saved view selected.'}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDeleteOpen(false)}>
              Keep it
            </Button>
            <Button variant="destructive" onClick={deleteActiveView} disabled={!selectedView}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
