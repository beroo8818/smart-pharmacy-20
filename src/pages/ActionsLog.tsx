import ActionLog from '../../shared/components/ActionLog';
import {supabase} from '@/integrations/supabase/client';
import {fetchPagedRows} from '@/lib/pagedQuery';
import {useAuth} from '@/hooks/useAuth';
import {hasPermission} from '../../shared/accessPolicy';
import type {RecommendationAction} from '../../shared/recommendationActions';
const load=()=>fetchPagedRows<RecommendationAction>(()=>(supabase as any).from('recommendation_actions').select('*').order('acted_at',{ascending:false}).order('id',{ascending:false}));
export default function ActionsLog(){const {roles,access}=useAuth();return <ActionLog load={load} canExport={hasPermission(roles,access,'report.export')}/>;}
