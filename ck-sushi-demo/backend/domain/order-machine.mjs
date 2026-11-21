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
 if(!FLOW[from].includes(to))throw new OrderTransitionError("ILLEGAL_ORDER_TRANSITION");
 if(to==="paid"&&(actor!=="payment_provider"||paymentStatus!=="approved"))throw new OrderTransitionError("PAYMENT_NOT_CONFIRMED");
 if(["accepted","preparing","ready","awaiting_courier","courier_assigned","picked_up","delivered"].includes(to)&&paymentStatus!=="approved")throw new OrderTransitionError("CANNOT_FULFILL_UNPAID_ORDER");
 if((to==="awaiting_courier"||to==="courier_assigned")&&fulfillment!=="delivery")throw new OrderTransitionError("COURIER_NOT_ALLOWED_FOR_PICKUP");
 if(to==="picked_up"&&from==="ready"&&fulfillment!=="pickup")throw new OrderTransitionError("DELIVERY_REQUIRES_COURIER");
 if(to==="refunded"&&actor!=="payment_provider")throw new OrderTransitionError("REFUND_NOT_VERIFIED");
 if(["courier_assigned","delivery_exception","delivered"].includes(to)&&actor==="payment_provider")throw new OrderTransitionError("INVALID_ACTOR_FOR_DELIVERY");
 return{from,to,actor};
}
export const ORDER_STATES=Object.freeze(Object.keys(FLOW));
