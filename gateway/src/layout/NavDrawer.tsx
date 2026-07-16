import AccountTreeOutlined from "@mui/icons-material/AccountTreeOutlined";
import ChatBubbleOutlineOutlined from "@mui/icons-material/ChatBubbleOutlineOutlined";
import ChevronLeft from "@mui/icons-material/ChevronLeft";
import ChevronRight from "@mui/icons-material/ChevronRight";
import FolderOutlined from "@mui/icons-material/FolderOutlined";
import MeetingRoomOutlined from "@mui/icons-material/MeetingRoomOutlined";
import PeopleOutlined from "@mui/icons-material/PeopleOutlined";
import SettingsOutlined from "@mui/icons-material/SettingsOutlined";
import SmartToyOutlined from "@mui/icons-material/SmartToyOutlined";
import VpnKeyOutlined from "@mui/icons-material/VpnKeyOutlined";
import {
  Box,
  Button,
  Divider,
  Drawer,
  IconButton,
  ListItemIcon,
  ListItemText,
  MenuItem,
  MenuList,
  Stack,
  Toolbar,
  Tooltip,
  Typography,
} from "@mui/material";
import { memo, useState } from "react";
import { NavLink, useLocation } from "react-router";
import type { ComponentType } from "react";
import { useAuth } from "../data/AuthContext";

interface NavItem {
  label: string;
  path: string;
  icon: ComponentType;
}

const NAV_ITEMS: NavItem[] = [
  { label: "Ecosystem", path: "/ecosystem", icon: AccountTreeOutlined },
  { label: "Rooms", path: "/rooms", icon: MeetingRoomOutlined },
  { label: "Resources", path: "/resources", icon: FolderOutlined },
  { label: "Agents", path: "/agents", icon: SmartToyOutlined },
  { label: "Messaging Apps", path: "/collaborations", icon: ChatBubbleOutlineOutlined },
  { label: "API Keys", path: "/registration-keys", icon: VpnKeyOutlined },
];

const ADMIN_ITEMS: NavItem[] = [
  { label: "Users", path: "/users", icon: PeopleOutlined },
];

const TRANSITION_CURVE = "0.2s cubic-bezier(0, 0, 0.12, 0.99)";

export default memo(function NavDrawer() {
  const [open, setOpen] = useState(true);
  const location = useLocation();
  const { user, logout } = useAuth();

  return (
    <Drawer
      variant="permanent"
      anchor="left"
      slotProps={{
        paper: {
          variant: "elevation",
          sx: { backgroundColor: "var(--mui-palette-background-nav)" },
        },
      }}
      sx={{
        transition: `width ${TRANSITION_CURVE}`,
        width: open ? "var(--nav-drawer-width)" : "var(--nav-closed-drawer-width)",
        "& .MuiPaper-root": {
          transition: `width ${TRANSITION_CURVE}`,
          width: open ? "var(--nav-drawer-width)" : "var(--nav-closed-drawer-width)",
          overflowX: "hidden",
        },
      }}
    >
      <Toolbar
        className="sticky-toolbar logo-bar"
        sx={{
          px: open ? "1rem !important" : "0 !important",
          justifyContent: open ? "space-between" : "center",
          minHeight: open ? undefined : "5rem !important",
          flexDirection: open ? "row" : "column",
          alignItems: "center",
          boxSizing: "border-box",
          width: open ? "var(--nav-drawer-width)" : "var(--nav-closed-drawer-width)",
        }}
      >
        {open && (
          <Typography variant="h6" sx={{ fontWeight: 700, color: "primary.main" }}>
            Switch Gateway
          </Typography>
        )}
        <Tooltip title={open ? "Collapse" : "Expand"} placement="right">
          <IconButton onClick={() => setOpen(!open)}>
            {open ? <ChevronLeft /> : <ChevronRight />}
          </IconButton>
        </Tooltip>
      </Toolbar>

      <MenuList sx={{ px: 0.75, py: 1, display: "flex", flexDirection: "column", gap: 0.5 }}>
        {NAV_ITEMS.map((item) => {
          const active = location.pathname.startsWith(item.path);
          return (
            <MenuItem
              key={item.path}
              component={NavLink}
              to={item.path}
              selected={active}
              sx={{
                borderRadius: 1,
                mx: 0.5,
                px: open ? 1.5 : 0.75,
                justifyContent: open ? "flex-start" : "center",
                "&.Mui-selected": {
                  backgroundColor: "var(--mui-palette-action-selected)",
                },
              }}
            >
              <ListItemIcon sx={{ minWidth: open ? 36 : "auto", color: "inherit" }}>
                <item.icon />
              </ListItemIcon>
              {open && <ListItemText primary={item.label} />}
            </MenuItem>
          );
        })}
      </MenuList>

      {user?.role === "admin" && (
        <>
          <Divider sx={{ mx: 1.5, my: 0.5 }} />
          {open && (
            <Typography
              variant="caption"
              sx={{ px: 2, py: 0.5, color: "text.secondary", display: "flex", alignItems: "center", gap: 0.5 }}
            >
              <SettingsOutlined sx={{ fontSize: 14 }} />
              Admin
            </Typography>
          )}
          <MenuList sx={{ px: 0.75, py: 0, display: "flex", flexDirection: "column", gap: 0.5 }}>
            {ADMIN_ITEMS.map((item) => {
              const active = location.pathname.startsWith(item.path);
              return (
                <MenuItem
                  key={item.path}
                  component={NavLink}
                  to={item.path}
                  selected={active}
                  sx={{
                    borderRadius: 1,
                    mx: 0.5,
                    px: open ? 1.5 : 0.75,
                    justifyContent: open ? "flex-start" : "center",
                    "&.Mui-selected": {
                      backgroundColor: "var(--mui-palette-action-selected)",
                    },
                  }}
                >
                  <ListItemIcon sx={{ minWidth: open ? 36 : "auto", color: "inherit" }}>
                    <item.icon />
                  </ListItemIcon>
                  {open && <ListItemText primary={item.label} />}
                </MenuItem>
              );
            })}
          </MenuList>
        </>
      )}

      <Divider sx={{ flexGrow: 1 }} />
      {open && (
        <Box sx={{ p: 2 }}>
          <Stack spacing={1}>
            <Stack direction="row" alignItems="center" gap={1}>
              <Box
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  backgroundColor: "#008E5B",
                }}
              />
              <Typography variant="body2" sx={{ color: "text.secondary" }}>
                System Healthy
              </Typography>
            </Stack>
            <Divider />
            <Typography
              variant="body2"
              sx={{ color: "text.secondary" }}
              noWrap
            >
              {user?.email}
            </Typography>
            <Button
              size="small"
              onClick={logout}
              sx={{ justifyContent: "flex-start" }}
            >
              Sign out
            </Button>
          </Stack>
        </Box>
      )}
    </Drawer>
  );
});
