import type { ComponentType } from "react";
import UrlsValueForm from "./UrlsValueForm";
import type { ValueFormProps } from "./types";

interface BuiltInProps extends ValueFormProps {
  // No extra props for the built-in variants.
}

/**
 * Map of reference type → form component for editing its `value` bag.
 * Add a new entry when a new reference type is added in the backend registry.
 * When a type is not registered here, the dialog falls back to a generic
 * JSON textarea so the user can still create the reference manually.
 */
export const VALUE_FORMS: Record<string, ComponentType<BuiltInProps>> = {
  google_drive: (props) => (
    <UrlsValueForm
      {...props}
      helperText="Paste links to Google Drive documents or folders."
    />
  ),
  confluence: (props) => (
    <UrlsValueForm
      {...props}
      helperText="Paste links to Confluence pages or spaces."
    />
  ),
  github: (props) => (
    <UrlsValueForm
      {...props}
      helperText="Paste links to GitHub repositories (e.g. https://github.com/org/repo)."
    />
  ),
  jira: (props) => (
    <UrlsValueForm
      {...props}
      helperText="Paste links to Jira projects, issues, or boards (e.g. https://your-org.atlassian.net/browse/PROJ-123)."
    />
  ),
};
