import {requireUser} from '../../../lib/paymentServer';
import {balanceContext} from '../../../lib/creditServer';
export const dynamic='force-dynamic';
export async function GET(request){try{return Response.json(await balanceContext((await requireUser(request)).id));}catch(error){return Response.json({message:error.message},{status:401});}}
