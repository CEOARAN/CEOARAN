/** Guardrails for future commercial orders. No production writes in staging. */
export class OrderTransitionError extends Error {constructor(code){super(code);this.name="OrderTransitionError";this.code=code}}
const FLOW=Object.freeze({
 pending_payment:["paid","cancelled"],
 paid:["accepted","cancelled","refund_pending"],
 accepted:["preparing","cancelled","refund_pending"],
 preparing:["ready","cancelled","refund_pending"],
 ready:["awaiting_courier","picked_up","cancelled","refund_pending"],
 awaiting_courier:["courier_assigned","cancelled","refund_pending"],
 courier_assigned:["picked_up","cancelled","refund_pending"],
 picked_up:["delivered","delivery_exception"],
 delivery_exception:["courier_assigned","delivered","refund_pending"],
 delivered:["refund_pending"],
 cancelled:["refund_pending"],
 refund_pending:["refunded","refund_failed"],
 refund_failed:["refund_pending"],
 refunded:[]
});
const ACTORS=new Set(["system","store","payment_provider","logistics_provider"]);
export function validateTransition({from,to,actor,paymentStatus,fulfillment}){
 if(!Object.hasOwn(FLOW,from)||!Object.hasOwn(FLOW,to))throw new OrderTransitionError("INVALID_ORDER_STATE");
 if(!ACTORS.has(actor))throw new OrderTransitionError("UNAUTHORIZED_TRANSITION_ACTOR");
 if(!["pickup","delivery"].includes(fulfillment))throw new OrderTransitionError("INVALID_FULFILLMENT");
 if(!FLOW[from].includes(to))throw new OrderTransitionError("ILLEGAL_ORDER_TRANSITION");
 if(to==="paid"&&(actor!=="payment_provider"||paymentStatus!=="approved"))throw new OrderTransitionError("PAYMENT_NOT_CONFIRMED");
 if(["accepted","preparing","ready","awaiting_courier","courier_assigned","picked_up","delivered"].includes(to)&&paymentStatus!=="approved")throw new OrderTransitionError("CANNOT_FULFILL_UNPAID_ORDER");
 if(["accepted","preparing","ready","awaiting_courier"].includes(to)&&actor!=="store")throw new OrderTransitionError("STORE_ACTION_REQUIRED");
 if(["courier_assigned","delivery_exception"].includes(to)&&actor!=="logistics_provider")throw new OrderTransitionError("LOGISTICS_ACTION_REQUIRED");
 if(["awaiting_courier","courier_assigned","delivery_exception"].includes(to)&&fulfillment!=="delivery")throw new OrderTransitionError("COURIER_NOT_ALLOWED_FOR_PICKUP");
 if(to==="picked_up"){
   if(fulfillment==="delivery"&&(from!=="courier_assigned"||actor!=="logistics_provider"))throw new OrderTransitionError("DELIVERY_REQUIRES_COURIER");
   if(fulfillment==="pickup"&&(from!=="ready"||actor!=="store"))throw new OrderTransitionError("PICKUP_REQUIRES_STORE_CONFIRMATION");
 }
 if(to==="delivered"&&actor!=="logistics_provider")throw new OrderTransitionError("DELIVERY_PROVIDER_CONFIRMATION_REQUIRED");
 if(to==="cancelled"&&!["system","store"].includes(actor))throw new OrderTransitionError("CANCELLATION_NOT_AUTHORIZED");
 if(to==="refund_pending"&&!["system","store"].includes(actor))throw new OrderTransitionError("REFUND_REQUEST_NOT_AUTHORIZED");
 if(to==="refunded"&&(actor!=="payment_provider"||paymentStatus!=="refunded"))throw new OrderTransitionError("REFUND_NOT_VERIFIED");
 if(to==="refund_failed"&&actor!=="payment_provider")throw new OrderTransitionError("REFUND_PROVIDER_REQUIRED");
 return{from,to,actor};
}
export const ORDER_STATES=Object.freeze(Object.keys(FLOW));
