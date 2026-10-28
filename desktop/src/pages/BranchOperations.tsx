import HospitalOperations from "../../../shared/components/HospitalOperations";
import { operationsCall } from "@/lib/operationsClient";
export default function BranchOperations({ access = false }: { access?: boolean }) { return <HospitalOperations call={operationsCall} access={access} local={true} />; }
