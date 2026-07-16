import ContentCopy from "@mui/icons-material/ContentCopy";
import Download from "@mui/icons-material/Download";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  FormGroup,
  Stack,
  Typography,
} from "@mui/material";
import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { type ExportYamlToggles, exportRoomYaml } from "../../data/api";

const YamlEditor = lazy(() => import("./YamlEditor"));

interface Props {
  open: boolean;
  onClose: () => void;
  roomId: string;
  roomName: string;
}

const SECTIONS = [
  { key: "agents", label: "Agents" },
  { key: "users", label: "Users" },
  { key: "references", label: "References" },
  { key: "docs", label: "Documents" },
  { key: "roles", label: "Roles" },
] as const;

export default function ExportRoomYamlDialog({
  open,
  onClose,
  roomId,
  roomName,
}: Props) {
  const [toggles, setToggles] = useState<Required<ExportYamlToggles>>({
    agents: true,
    users: true,
    references: true,
    docs: true,
    roles: true,
  });
  const [yamlText, setYamlText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    exportRoomYaml(roomId, toggles)
      .then((text) => {
        if (!cancelled) setYamlText(text);
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Failed to export.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, roomId, toggles]);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(yamlText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [yamlText]);

  const handleDownload = useCallback(() => {
    const safeName = roomName.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    const blob = new Blob([yamlText], { type: "application/x-yaml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safeName || "room"}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  }, [yamlText, roomName]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Export room to YAML</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <Stack spacing={0.5}>
            <Typography variant="subtitle2" color="text.secondary">
              Include sections
            </Typography>
            <FormGroup row>
              {SECTIONS.map(({ key, label }) => (
                <FormControlLabel
                  key={key}
                  control={
                    <Checkbox
                      size="small"
                      checked={toggles[key]}
                      onChange={(e) =>
                        setToggles((t) => ({ ...t, [key]: e.target.checked }))
                      }
                    />
                  }
                  label={label}
                />
              ))}
            </FormGroup>
          </Stack>
          <Suspense
            fallback={
              <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
                <CircularProgress />
              </Box>
            }
          >
            <YamlEditor value={loading ? "" : yamlText} readOnly minHeight="50vh" />
          </Suspense>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        <Button
          startIcon={loading ? <CircularProgress size={16} /> : <ContentCopy />}
          onClick={handleCopy}
          disabled={loading || !yamlText}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
        <Button
          variant="contained"
          startIcon={<Download />}
          onClick={handleDownload}
          disabled={loading || !yamlText}
        >
          Download
        </Button>
      </DialogActions>
    </Dialog>
  );
}
