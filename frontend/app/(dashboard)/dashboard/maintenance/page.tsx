import { redirect } from "next/navigation";
export default function MaintenanceRedirect() {
  redirect("/dashboard/issues?maintenance=1");
}
