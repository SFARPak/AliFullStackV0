import { createRootRoute, Outlet } from "@tanstack/react-router";
import Layout from "../app/layout";

export const rootRoute = createRootRoute({
  component: () => (
    <Layout>
      <Outlet />
    </Layout>
  ),
});
