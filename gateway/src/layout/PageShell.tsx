import { Box, Stack } from "@mui/material";
import { Outlet } from "react-router";
import NavDrawer from "./NavDrawer";

export default function PageShell() {
  return (
    <Box sx={{ display: "flex", height: "100vh" }}>
      <NavDrawer />
      <Stack
        component="main"
        sx={{
          flexGrow: 1,
          overflowY: "auto",
          backgroundColor: "var(--mui-palette-background-default)",
          p: 3,
        }}
      >
        <Outlet />
      </Stack>
    </Box>
  );
}
