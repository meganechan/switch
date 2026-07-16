import ContentCopy from "@mui/icons-material/ContentCopy";
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
} from "@mui/material";
import { useCallback, useState } from "react";
import { createApiKey } from "../../data/api";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export default function CreateKeyDialog({ open, onClose, onCreated }: Props) {
  const [label, setLabel] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ key: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const reset = useCallback(() => {
    setLabel("");
    setSubmitting(false);
    setError(null);
    setResult(null);
    setCopied(false);
  }, []);

  const handleClose = useCallback(() => {
    if (result) onCreated();
    reset();
    onClose();
  }, [result, onCreated, reset, onClose]);

  const handleSubmit = useCallback(async () => {
    if (!label) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await createApiKey(label);
      setResult({ key: res.key });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create key.");
    } finally {
      setSubmitting(false);
    }
  }, [label]);

  const handleCopy = useCallback(() => {
    if (!result) return;
    const text = result.key;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [result]);

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>{result ? "Key Created" : "Create API Key"}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {result ? (
            <>
              <Alert severity="warning">
                Copy the key now. It will not be shown again.
              </Alert>
              <TextField
                label="Registration Key"
                value={result.key}
                fullWidth
                slotProps={{
                  input: {
                    readOnly: true,
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton onClick={handleCopy} size="small">
                          <ContentCopy fontSize="small" />
                        </IconButton>
                      </InputAdornment>
                    ),
                  },
                }}
                helperText={copied ? "Copied!" : undefined}
              />
            </>
          ) : (
            <>
              {error && <Alert severity="error">{error}</Alert>}
              <TextField
                label="Label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                fullWidth
                required
                placeholder="e.g. My ADK connector"
              />
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        {result ? (
          <Button onClick={handleClose} variant="contained">
            Done
          </Button>
        ) : (
          <>
            <Button onClick={handleClose}>Cancel</Button>
            <Button
              variant="contained"
              onClick={handleSubmit}
              disabled={submitting || !label}
              startIcon={
                submitting ? <CircularProgress size={16} /> : undefined
              }
            >
              Create
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
