import { createFileRoute } from "@tanstack/react-router";
import { ControlPanel } from "@/components/panel/control-panel";

export const Route = createFileRoute("/")({ component: ControlPanel });
