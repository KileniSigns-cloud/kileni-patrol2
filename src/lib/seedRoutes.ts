import { supabase } from './supabase';

export const fixRouteOrg = async () => {
  const { error } = await supabase
    .from('patrol_routes')
    .update({ organisation_id: '8239bb55-2423-43c1-bb54-6370765f2275' })
    .eq('organisation_id', '7c1e72b8-2839-42ab-a929-ce758c7d3af1');

  console.log('Routes org fixed:', error ?? 'success');
};
