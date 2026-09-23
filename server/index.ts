import type { Request, Response, NextFunction } from "express";
import { requireSessionSecret } from "./session-security.mjs";

// Validate before dynamically loading application modules. Some of those
// modules initialize database dependencies as an import side effect.
requireSessionSecret(process.env);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

(async () => {
  const { default: express } = await import("express");
  const { evidenceRequestBoundary, isEvidenceRequestPath, evidenceErrorResponse } = await import("./evidence-http");
  const { createServer } = await import("http");
  const { setupAuth } = await import("./auth");

  const app = express();
  const httpServer = createServer(app);

  app.set("trust proxy", 1);

  // Read-only search still carries private questions. Bound parsing before
  // global parsers; disabled deployments must not parse or query this feature.
  app.use("/api/evidence", evidenceRequestBoundary, express.json({ limit: "8kb" }));

  app.use(
    express.json({
      limit: "15mb",
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );

  app.use(express.urlencoded({ extended: false, limit: "15mb" }));

  app.use((req, res, next) => {
    const start = Date.now();
    const path = isEvidenceRequestPath(req.path) ? "/api/evidence" : req.path;
    res.on("finish", () => {
      const duration = Date.now() - start;
      if (path.startsWith("/api")) {
        const logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
        log(logLine);
      }
    });

    next();
  });

  await setupAuth(app);

  const { registerRoutes } = await import("./routes");
  const { serveStatic } = await import("./static");

  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    if (isEvidenceRequestPath(_req.path)) {
      if (res.headersSent) return next(new Error("Evidence request failed"));
      return evidenceErrorResponse(err, res);
    }
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    const managedTestServer =
      process.env.MANAGED_TEST_SERVER_IPC === "1"
      && Boolean(process.env.TEST_RUN_CONTEXT_FILE);

    if (managedTestServer) {
      console.error("Managed test server request failed");
    } else {
      console.error("Internal Server Error:", err);
    }

    if (res.headersSent) {
      return next(managedTestServer ? new Error("Managed test server request failed") : err);
    }

    return res.status(status).json({
      message: managedTestServer ? "Internal Server Error" : message,
    });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  const managedTestServer =
    process.env.MANAGED_TEST_SERVER_IPC === "1"
    && Boolean(process.env.TEST_RUN_CONTEXT_FILE);
  httpServer.listen(
    {
      port,
      host: managedTestServer ? "127.0.0.1" : "0.0.0.0",
      reusePort: managedTestServer ? false : true,
    },
    () => {
      const address = httpServer.address();
      const boundPort = address && typeof address !== "string" ? address.port : port;
      log(`serving on port ${boundPort}`);
      if (
        managedTestServer
        && typeof process.send === "function"
        && process.connected
      ) {
        try {
          process.send({
            type: "managed-server-listening",
            pid: process.pid,
            port: boundPort,
          }, undefined, undefined, () => undefined);
        } catch {
          // The managed parent may have gone away during startup.
        }
      }
    },
  );
})();
