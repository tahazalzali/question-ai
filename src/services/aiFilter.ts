import { FilterService } from './aiFilter/filterService';

export async function filterAndNormalize(rawResults: any[]): Promise<any[]> {
  const service = new FilterService();
  return service.run(rawResults);
}