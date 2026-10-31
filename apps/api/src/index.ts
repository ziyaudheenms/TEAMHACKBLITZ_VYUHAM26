import { Hono } from "hono";
import { cors } from "hono/cors";
import authRoutes from "./routes/auth";
import organisationsRoutes from "./routes/organisations";
import departmentsRoutes from "./routes/departments";
import employeesRoutes from "./routes/employees";
import knowledgeRoutes from "./routes/knowledge";
import employeeDocumentsRoutes from "./routes/employee-documents";
import filesRoutes from "./routes/files";
import ticketsRoutes from "./routes/tickets";
import { aiRouter } from "./routes/ai";
import projectsRoutes from "./routes/projects";
import tasksRoutes from "./routes/tasks";
import notificationsRoutes from "./routes/notifications";
import meetingsRoutes from "./routes/meetings";
import analyticsRoutes from "./routes/analytics";
import searchRoutes from "./routes/search";
import agentsRoutes from "./routes/agents";
import adminRoutes from "./routes/admin";
import invitationsRoutes from "./routes/invitations";
import channelsRoutes from "./routes/channels";
import assignmentRoutes from "./routes/assignment";

const app = new Hono();
const v1 = new Hono();

// CORS configuration: Support CORS_ORIGIN env var and ensure all frontend headers are permitted
const allowedOriginEnv = process.env.CORS_ORIGIN;
const allowedOrigins = allowedOriginEnv ? allowedOriginEnv.split(",").map((o) => o.trim()) : null;

app.use(
  "*",
  cors({
    origin: (origin) => {
      if (!allowedOrigins || allowedOrigins.includes("*")) return "*";
      if (!origin) return "*";
      return allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
    },
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: [
      "Content-Type",
      "Authorization",
      "X-User-Id",
      "X-Organisation-Id",
      "X-Custom-Header",
      "X-Requested-With",
      "apikey",
    ],
    exposeHeaders: ["Content-Length", "X-Kuma-Revision"],
    credentials: true,
  })
);

// Health Check
app.get("/health", (c) => {
  return c.json({
    status: "ok",
    version: "0.1.0",
    service: "bizcontext-api",
    timestamp: new Date().toISOString(),
  });
});

// V1 API Router Entry Points
v1.get("/", (c) => {
  return c.json({
    message: "BizContext AI API v1 Operational",
    endpoints: [
      "/api/v1/auth",
      "/api/v1/ai",
      "/api/v1/organisations",
      "/api/v1/departments",
      "/api/v1/employees",
      "/api/v1/employee-documents",
      "/api/v1/knowledge/pages",
      "/api/v1/files",
      "/api/v1/projects",
      "/api/v1/tasks",
      "/api/v1/tickets",
      "/api/v1/meetings",
      "/api/v1/notifications",
      "/api/v1/agents",
      "/api/v1/agent-executions",
      "/api/v1/integrations",
      "/api/v1/search",
      "/api/v1/analytics",
      "/api/v1/assignment",
    ],
  });
});

v1.route("/auth", authRoutes);
v1.route("/organisations", organisationsRoutes);
v1.route("/departments", departmentsRoutes);
v1.route("/employees", employeesRoutes);
v1.route("/knowledge", knowledgeRoutes);
v1.route("/employee-documents", employeeDocumentsRoutes);
v1.route("/files", filesRoutes);
v1.route("/tickets", ticketsRoutes);
v1.route("/ai", aiRouter);
v1.route("/projects", projectsRoutes);
v1.route("/tasks", tasksRoutes);
v1.route("/notifications", notificationsRoutes);
v1.route("/meetings", meetingsRoutes);
v1.route("/search", searchRoutes);
v1.route("/analytics", analyticsRoutes);
v1.route("/agents", agentsRoutes);
v1.route("/admin", adminRoutes);
v1.route("/invitations", invitationsRoutes);
v1.route("/channels", channelsRoutes);
v1.route("/assignment", assignmentRoutes);

app.route("/api/v1", v1);

const port = Number(process.env.PORT) || Number(process.env.API_PORT) || 3001;
const hostname = process.env.HOST || "0.0.0.0";

console.log(`BizContext AI API running on http://${hostname}:${port}`);

export default {
  port,
  hostname,
  fetch: app.fetch,
};
