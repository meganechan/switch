import ArrowBack from "@mui/icons-material/ArrowBack";
import DeleteOutline from "@mui/icons-material/DeleteOutline";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import {
  type DocumentDetail,
  fetchDocument,
  updateDocument,
} from "../../data/api";
import { useAuth } from "../../data/AuthContext";
import { AccessChip, AccessSelect } from "../../components/AccessControls";
import {
  type AccessLevel,
  fromAccessLevel,
  toAccessLevel,
} from "../../data/visibility";
import { usePackages } from "../../data/hooks";
import DeleteResourceDialog from "./DeleteResourceDialog";
import ResourceAttachmentsSection from "./ResourceAttachmentsSection";

export default function DocumentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [doc, setDoc] = useState<DocumentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    fetchDocument(id).then((d) => {
      if (cancelled) return;
      if (d) setDoc(d);
      else setFetchError("Document not found");
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (fetchError || !doc || !id) {
    return (
      <Box>
        <Button startIcon={<ArrowBack />} onClick={() => navigate("/resources")}>
          Back to resources
        </Button>
        <Alert severity="error" sx={{ mt: 2 }}>
          {fetchError ?? "Document not found"}
        </Alert>
      </Box>
    );
  }

  const canMutate =
    !!user && (user.id === doc.owner_id || user.role === "admin");

  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={1} mb={2}>
        <IconButton
          onClick={() => navigate("/resources?tab=documents")}
          size="small"
        >
          <ArrowBack />
        </IconButton>
        <Typography variant="h5" sx={{ flexGrow: 1 }}>
          {doc.name || "Document"}
        </Typography>
        <AccessChip pair={doc} />
      </Stack>

      <Paper variant="outlined" sx={{ borderRadius: 2, p: 3 }}>
        <Stack spacing={4}>
          <DocInfoSection doc={doc} />
          <Divider />
          <EditFieldsSection
            doc={doc}
            canMutate={canMutate}
            onSaved={(updated) => setDoc(updated)}
          />
          <Divider />
          <InPackagesSection packageIds={doc.packages ?? []} />
          <Divider />
          <ResourceAttachmentsSection kind="document" resourceId={id} />
          {canMutate && (
            <>
              <Divider />
              <DangerSection onDelete={() => setDeleteOpen(true)} />
            </>
          )}
        </Stack>
      </Paper>

      <DeleteResourceDialog
        open={deleteOpen}
        kind="document"
        resourceId={id}
        resourceLabel={doc.name || id}
        onClose={() => setDeleteOpen(false)}
        onDeleted={() => navigate("/resources?tab=documents")}
      />
    </Box>
  );
}

function DocInfoSection({ doc }: { doc: DocumentDetail }) {
  return (
    <Stack spacing={1}>
      <Typography variant="subtitle2" color="text.secondary">
        Info
      </Typography>
      <InfoLine label="Owner" value={doc.owner_name ?? doc.owner_id ?? "—"} />
      <InfoLine
        label="Created"
        value={new Date(doc.created_at).toLocaleString()}
      />
    </Stack>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <Typography variant="body2" color="text.secondary">
      <strong>{label}:</strong> {value}
    </Typography>
  );
}

function EditFieldsSection({
  doc,
  canMutate,
  onSaved,
}: {
  doc: DocumentDetail;
  canMutate: boolean;
  onSaved: (updated: DocumentDetail) => void;
}) {
  const [name, setName] = useState(doc.name);
  const [description, setDescription] = useState(doc.description);
  const [instructions, setInstructions] = useState(doc.instructions);
  const [content, setContent] = useState(doc.content);
  const [access, setAccess] = useState<AccessLevel>(toAccessLevel(doc));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = useMemo(
    () =>
      name !== doc.name ||
      description !== doc.description ||
      instructions !== doc.instructions ||
      content !== doc.content ||
      access !== toAccessLevel(doc),
    [name, description, instructions, content, access, doc],
  );

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await updateDocument(doc.id, {
        name,
        description,
        instructions,
        content,
        ...fromAccessLevel(access),
      });
      onSaved(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack spacing={2}>
      <Typography variant="subtitle2" color="text.secondary">
        Details
      </Typography>
      <TextField
        label="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        disabled={!canMutate || saving}
      />
      <TextField
        label="Description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        disabled={!canMutate || saving}
        multiline
        minRows={2}
        helperText="Short, human-readable summary. Shown in lists."
      />
      <TextField
        label="Instructions"
        value={instructions}
        onChange={(e) => setInstructions(e.target.value)}
        disabled={!canMutate || saving}
        multiline
        minRows={4}
        helperText="Sent to agents on connect. Not shown in lists."
      />
      <TextField
        label="Content"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        disabled={!canMutate || saving}
        multiline
        minRows={12}
        slotProps={{ input: { sx: { fontFamily: "monospace" } } }}
      />
      <AccessSelect
        value={access}
        onChange={setAccess}
        disabled={!canMutate || saving}
        sx={{ maxWidth: 320 }}
      />
      {error && <Alert severity="error">{error}</Alert>}
      <Box>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={!canMutate || !dirty || saving}
          startIcon={saving ? <CircularProgress size={16} /> : undefined}
        >
          Save
        </Button>
      </Box>
    </Stack>
  );
}

function InPackagesSection({ packageIds }: { packageIds: string[] }) {
  const navigate = useNavigate();
  const { data: allPackages } = usePackages();
  const nameById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const p of allPackages ?? []) m[p.id] = p.name || p.description;
    return m;
  }, [allPackages]);
  return (
    <Stack spacing={1}>
      <Typography variant="subtitle2" color="text.secondary">
        In packages
      </Typography>
      {packageIds.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Not in any package.
        </Typography>
      ) : (
        <Stack direction="row" flexWrap="wrap" gap={0.5}>
          {packageIds.map((pid) => (
            <Chip
              key={pid}
              label={nameById[pid] ?? pid}
              size="small"
              variant="outlined"
              onClick={() => navigate(`/resources/packages/${pid}`)}
              sx={{ cursor: "pointer" }}
            />
          ))}
        </Stack>
      )}
    </Stack>
  );
}

function DangerSection({ onDelete }: { onDelete: () => void }) {
  return (
    <Stack spacing={1}>
      <Typography variant="subtitle2" color="error">
        Danger zone
      </Typography>
      <Button
        variant="outlined"
        color="error"
        startIcon={<DeleteOutline />}
        onClick={onDelete}
        sx={{ alignSelf: "flex-start" }}
      >
        Delete document
      </Button>
    </Stack>
  );
}
