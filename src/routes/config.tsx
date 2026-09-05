import { createFileRoute } from "@tanstack/react-router";
import { ConfigApp } from "@/components/config/config-app";

export const Route = createFileRoute("/config")({ component: ConfigApp });
