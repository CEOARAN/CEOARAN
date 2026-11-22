/**
 * Admin read-side of future commerce. Does not return encrypted customer data,
 * customer names/phones/addresses, provider payment IDs, or secrets.
 * Caller MUST require valid Cloudflare Access and an approved role.
 */
import {ORDER_STATES} from "./order-machine.mjs";
export class OrderQueryError extends Error{
 constructor(code){super(code);this.name="OrderQueryError";this.code=code}
}
const ORDER_QUERY_ID=/^[A-Za-z0-9_-]{8,120}$/;
const ORDER_CURSOR_TIME=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ORDER_READ_LIMIT=50;
const ORDER_STATUS_GROUPS=Object.freeze({
 pending:["pending_payment","paid","accepted","preparing","ready","awaiting_courier",
  "courier_assigned","picked_up","delivery_exception","refund_pending","refund_failed"],
 done:["delivered","refunded"],
 cancelled:["cancelled"]
});

function parseCursor(cursor){
 if(cursor===null||cursor===undefined||cursor==="")return null;
 if(typeof cursor!=="string"||cursor.length>400||!/^[A-Za-z0-9_-]+$/.test(cursor))
  throw new OrderQueryError("INVALID_CURSOR");
 try{
  const decoded=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(Uint8Array.from(
   atob(cursor.replace(/-/g,"+").replace(/_/g,"/")),c=>c.charCodeAt(0))));
  if(!Array.isArray(decoded)||decoded.length!==2||!ORDER_CURSOR_TIME.test(decoded[0])||
     !ORDER_QUERY_ID.test(decoded[1]))throw Error("Bad cursor");
  return decoded;
 }catch{throw new OrderQueryError("INVALID_CURSOR")}
}
function makeCursor(row){
 const raw=JSON.stringify([row.placed_at,row.id]);
 return btoa(raw).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
export async function listRecentOrdersForAdmin(db,{status=null,group=null,limit=30,cursor=null}={}){
 if(!db||typeof db.prepare!=="function")throw new OrderQueryError("DATABASE_REQUIRED");
 if(status!==null&&!ORDER_STATES.includes(status))throw new OrderQueryError("INVALID_STATUS_FILTER");
 if(group!==null&&(!Object.hasOwn(ORDER_STATUS_GROUPS,group)||status!==null))throw new OrderQueryError("INVALID_STATUS_GROUP");
 if(!Number.isInteger(limit)||limit<1||limit>ORDER_READ_LIMIT)throw new OrderQueryError("INVALID_PAGE_SIZE");
 const position=parseCursor(cursor);
 const conditions=[],values=[];
 if(status!==null){conditions.push("status=?");values.push(status)}
 if(group!==null){const valuesForGroup=ORDER_STATUS_GROUPS[group];conditions.push("status IN ("+valuesForGroup.map(()=>"?").join(",")+")");values.push(...valuesForGroup)}
 if(position){conditions.push("(placed_at<? OR (placed_at=? AND id<?))");values.push(position[0],position[0],position[1])}
 const where=conditions.length?" WHERE "+conditions.join(" AND "):"";
 const rows=await db.prepare("SELECT id,status,payment_status,fulfillment,currency,subtotal_cents,discount_cents,delivery_fee_cents,total_cents,placed_at,updated_at,version FROM commerce_orders"+
  where+" ORDER BY placed_at DESC,id DESC LIMIT ?").bind(...values,limit+1).all();
 const data=rows?.results||[];
 const orders=data.slice(0,limit);
 return {orders,next_cursor:data.length>limit&&orders.length?makeCursor(orders[orders.length-1]):null};
}
export async function getOrderDetailsForAdmin(db,{orderId}={}){
 if(!db||typeof db.prepare!=="function")throw new OrderQueryError("DATABASE_REQUIRED");
 if(typeof orderId!=="string"||!ORDER_QUERY_ID.test(orderId))throw new OrderQueryError("INVALID_ORDER_ID");
 const order=await db.prepare("SELECT id,status,payment_status,fulfillment,currency,subtotal_cents,discount_cents,delivery_fee_cents,total_cents,placed_at,updated_at,version FROM commerce_orders WHERE id=?").bind(orderId).first();
 if(!order)return null;
 const [lines,events]=await Promise.all([
  db.prepare("SELECT line_no,product_id,name_snapshot,unit_price_cents,quantity,total_cents FROM commerce_order_lines WHERE order_id=? ORDER BY line_no LIMIT 30").bind(orderId).all(),
  db.prepare("SELECT id,actor_type,from_status,to_status,recorded_at FROM commerce_order_events WHERE order_id=? ORDER BY id LIMIT 200").bind(orderId).all()
 ]);
 return {order,items:lines?.results||[],events:events?.results||[]};
}
