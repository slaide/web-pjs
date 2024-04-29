/// the central 'p' object is located here. It offers global functionality to the whole page to make it more reactive and interactive

/// new data can be introduced by just setting p.mynewdate=123
/// new functions can be introduced the same way, p.myfunc=function(){...}
/// to make data observable (more about this later), the new data needs either:
/// - if it is set outside of any interactive components:
/// - - needs to be an object with _observable:true, e.g. p.mynewdate={_observable:true, value:123}
/// - if it is set inside of an interactive component:
/// - - needs to be an wrapped manually with ObservableObject, e.g. p.mynewdate=new ObservableObject({value:123})

/// the p object is only accessible to an element if it has the class 'data', i.e. not to the whole subtree (!)
/// this allows the use of several shorthands and special functionality for the element:
/// - p:init='somefunc' -> calls p.somefunc(subtree_root_element) after the subtree is initialized
/// - p:init-vis='somefunc' -> calls p.somefunc(subtree_root_element) when the subtree is first drawn (e.g. when it becomes visible)
/// - p:on-eventname='somefunc' -> calls p.somefunc(event) when eventname is triggered on any element inside the subtree
/// - p:on-eventname='somefunc1,somefunc2' -> calls p.somefunc1(event) and p.somefunc2(event) when eventname is triggered on any element inside the subtree
/// - p:on-event1,event2='somefunc1,somefunc2' -> calls p.somefunc1(event) and p.somefunc2(event) when event1 or event2 is triggered on any element inside the subtree
/// - p:tooltip='some text' -> shows a tooltip with the given text when hovering over the element
/// - p:tooltip='#some_id' -> shows a tooltip with the innerHTML of the element with id 'some_id' when hovering over the element
/// - p:on-attrchange(src)='somefunc' -> calls p.somefunc(element) when the src attribute of the element changes
/// - p:on-attrchange(src,srcset)='somefunc' -> calls p.somefunc(element) when the src or srcset attribute of the element changes
/// - p:for='let i=0;i<5;i++' -> replaces the outerHTML of the element with copies of the innerHTML, where all {{whatever}} are replaced with the evaluated expression

/// - p:bind='p.mynewdate' -> binds the value of the input field to p.mynewdate (includes initialization, binds both ways, i.e. changes to p.mynewdate are reflected in the input field, and changes to the input field are reflected in p.mynewdate)

/// the one single exception (currently) to this rule are templates, which are lifted out of a subtree and saved in p.templates:
/// - <template name='some_template_name'>...</template> -> saves the template for later use
/// - the template is then accessible as p.templates.get(some_template_name) as DocumentSnippet (only after the initialization of the subtree is complete, i.e. it is not immediately available in p:init, but e.g. in p:init-vis)

class Info{
    constructor(){
        this.element=null
        this.target=null
    }
}

class EventFuncArgument{
    /**
     * 
     * @param {string?} property 
     * @param {{value?:any,target?:any,currentTarget?:any,element?:any}?} otherargs
     */
    constructor(property,otherargs){
        this.property=property

        if(!otherargs){return}
        this.value=otherargs.value
        this.target=otherargs.target
        this.currentTarget=otherargs.currentTarget
        this.element=otherargs.element
    }
}

/**
 * @callback EventFunc
 * @param {EventFuncArgument} info
 */

class Binding{
    /**
     * @param {string} bindname
     * @param {any} value
     */
    constructor(bindname,value){
        this.bindname=bindname
        this.value=value
    }
}

class ElementInfo{
    constructor(){
        this.p={}
    }
}

/**
 * checks if the argument is an object 
 * @param {any} obj 
 * @returns {boolean}
 */
function isObject(obj) {
    return obj === Object(obj)
}
/**
 * checks if the argument is iterable
 * @param {any} obj 
 * @returns {boolean}
 */
function isIterable(obj){
    return Symbol.iterator in Object(obj)
}
/**
 * returns the key of obj that has the value val, i.e. such that obj[key]===val
 * @param {any} obj 
 * @param {number|string} val 
 * @returns {undefined|number|string}
 */
function keyOf(obj,val){
    for(let key in obj){
        if(obj[key]===val){
            return key
        }
    }
    return undefined
}

/**
 * wrap a value to make it behave like an object (i.e. can be used in an observable object)
 * @template T
 */
class ValueObject{
    /**
     * @param {T} value
     */
    constructor(value){
        this._isValueObject=true
        this._value=value
    }

    valueOf(){
        return this._value
    }
}

let observable_ret_container=true

// this is a basic template class called TestClass here the parameter T extends object


// end basic template class

/**
 * @template {object} T 
 */
class ObservableObject{
    /**
     * 
     * @param {T} obj 
     * @param {null|any} parent
     */
    constructor(obj,parent=null){
        // @ts-ignore
        obj._isObservable=true

        this._obj=obj
        /** @type EventFunc[] */
        this._callbacks=[]
        this._running=false
        this._paused=false
        /** @type any[] */
        this._deferredChanges=[]
        this._callbacks_ongoing=false
        this._paused=false

        this._parent=parent

        let handler = {
            /**
             * getter for the proxy object
             * called on target[property], with receiver being the proxy object
             * @param {object} target is obj
             * @param {any} property property name (can be any value, not just strings)
             * @param {ProxyHandler<object>} receiver is obj._proxy
             * @returns 
             */
            get: (target, property, receiver) => {
                const val=this.get(property)
                if(property.startsWith && property.startsWith("_")){
                    return val
                }

                if (property === "onChange"){
                    return this.onChange.bind(this)
                }

                if(property===Symbol.iterator){
                    const me=this
                    return function*(){
                        for(let key in target){
                            yield [key,me.get(key)]
                        }
                    }
                }

                if(this.isPubliclyIterableSymbol(property)){
                    let new_val={}
                    if(isObject(val)) {
                        new_val=make_observable(val, this._proxy)
                    }else{
                        new_val=make_observable(new ValueObject(val), this._proxy)
                    }
                    this.set(property,new_val)
                }

                // @ts-ignore
                let ret_val=Reflect.get(this._obj,property,receiver)
                
                if((!observable_ret_container) && ret_val._isValueObject){
                    return ret_val.get()
                }

                return ret_val
            },
            /**
             * getter for the proxy object
             * called on target[property]=value
             * 'this' is the proxy object (obj._proxy)
             * @param {object} target is obj
             * @param {string|symbol} property property name (can be any value, not just strings)
             * @param {any} value
             * @returns 
             */
            set: (target, property, value) => {
                // dont overwrite setter of private properties
                // if property is not a number, and starts with _, it is private
                if(typeof property === 'string' && property.startsWith("_") && !(obj instanceof ValueObject && property==="_value")){
                    return Reflect.set(target, property, value);
                }

                let old_value=this.get(property)

                if(!isObject(value)){
                    value=new ValueObject(value)
                }
                
                value=make_observable(value, this._proxy)
                let current_target=value

                // if there was an object before, inherit its callbacks
                if (isObject(old_value) && old_value._callbacks) {
                    for(let cb of old_value._callbacks){
                        value.onChange(cb)
                    }
                }

                const result = Reflect.set(obj, property, value)

                if(this._paused){
                    this._deferredChanges=[current_target,property,value,target]
                    return result;
                }

                this._applyCallbacks(current_target,property,value,target)

                return result;
            }
        };

        this._proxy=new Proxy(obj,handler)
    }

    /**
     * register cb to be called when the object changes
     * @param {EventFunc} cb 
     * @returns {EventFunc} function handle that removes the callback when called itself
     */
    onChange(cb){
        this._callbacks.push(cb)

        const obj=this
        return function(){
            obj._callbacks=obj._callbacks.filter(c=>c!==cb)
        }
    }

    /**
     * 
     * @param {string|symbol} symbolname
     * @returns any 
     */
    get(symbolname){
        let descriptor=Object.getOwnPropertyDescriptor(this,symbolname)
        if(descriptor===undefined){
            descriptor=Object.getOwnPropertyDescriptor(this._proxy,symbolname)
            if(descriptor===undefined){
                return undefined
            }
        }
        return descriptor.value
    }
    /**
     * 
     * @param {string} symbolname
     * @param {any} new_value 
     */
    set(symbolname,new_value){
        Object.defineProperty(this,symbolname,{
            value: new_value,
            writable: true,
        })
    }

    /**
     * 
     * @param {string} symbolname 
     * @returns {boolean}
     */
    isPubliclyIterableSymbol(symbolname){
        if(symbolname.startsWith && symbolname.startsWith("_")){
            return false
        }

        // if the attribute is not defined, skip it
        // @ts-ignore
        if(!this._obj.hasOwnProperty(symbolname)){
            return false
        }

        // if the attribute is callable, skip it
        if(typeof this.get(symbolname) === 'function'){
            console.log("symbolname",symbolname,"is callable")
            return false
        }
        console.log(symbolname,"is not callable")

        return true
    }


    /**
     * trigger callbacks of the object and all its parents
     * @template {object} C
     * @param {ObservableObject<C>} current_target object that callbacks are triggered on
     * @param {any} property property that changed
     * @param {any} value new value
     * @param {*} target object that had its property value changed
     */
    _applyCallbacks(current_target,property,value,target){
        // if the value was changed, call all callbacks, then call all callbacks of the parent object, etc.
        // only propagate the change to parents until an object is hit that has already been changed (rather, that has started propagating changes itself)
        //
        // this is still not perfect because it doesn't handle the case where an object is changed twice in the same frame, but it's good enough for now
        // (the problem is that the value can be changed multiple times, but the callback is only run after the first change)
        let current_context_callbacks_registered=[]
        while(current_target){
            if(current_target._proxy==null || current_target._callbacks_ongoing){
                break
            }
            current_context_callbacks_registered.push(current_target)
            current_target._callbacks_ongoing=true
            current_target._callbacks.forEach(cb=>cb(new EventFuncArgument(property, {"value":value, "target":target})))
            current_target=current_target._parent
        }

        for(let unroll_target of current_context_callbacks_registered){
            unroll_target._callbacks_ongoing=false
        }
    }

    /**
     * 
     * @param {string?} property 
     * @param {*} value 
     * @param {*} target 
     */
    _trigger(property=null,value=null,target=null){
        this._applyCallbacks(this,property,value,target)
    }

    /**
     * @template T
     * @param {T} self
     * @param {(arg0: T) => void} cb 
     */
    static _withPaused(self,cb){
        if(!(self instanceof ObservableObject)){return}
        self.withPaused(cb)
    }

    /**
     * @param {(arg0: T) => void} cb 
     */
    withPaused(cb){
        this._paused=true
        cb(this._obj)
        this._paused=false
        this._trigger(...this._deferredChanges)
        this._deferredChanges=[]
    }
    /**
     * @param {(cb: T) => T} cb 
     */
    with(cb){
        if(this._obj instanceof ValueObject){
            let old_val=this._obj._value
            let new_val=cb(old_val)
            this._obj._value=new_val
            this._trigger(undefined,new_val,this._obj)
        }else{
            this.withPaused((obj)=>{
                cb(obj)
            })
        }
    }

    copyRaw(){
        // this function strips the proxy from the object (and all its attributes, recursively) and returns the raw object

        if(Array.isArray(this._obj)){
            let raw_arr=[]
            for(let element of this._obj){
                if(isObject(element)){
                    // if the element is observable, copy it recursively
                    if(!element.copyRaw){
                        // this creates element._proxy, if it does not exist yet!
                        element=make_observable(element,this._proxy).copyRaw()
                    }else{
                        raw_arr.push(element.copyRaw())
                    }
                }else{
                    raw_arr.push(element)
                }
            }
            return raw_arr
        }

        /** @type object */
        let raw_obj={}
        for(let key in this._obj){
            if(!this.isPubliclyIterableSymbol(key)){
                continue
            }

            let new_value=undefined
            if(isObject(this.get(key))){
                new_value=this.get(key).copyRaw()
            }else{
                new_value=this.get(key)
            }

            Object.defineProperty(raw_obj,key,{
                value: new_value,
                writable: true,
            })
        }

        return raw_obj
    }
}

/**
 * @param{any} obj
 * @returns {boolean}
 * */
function isObservable(obj){
    return (obj instanceof ObservableObject) || obj._isObservable
}

/**
 * return a wrapper around an object that makes it observable
 * i.e. allows to register callbacks that are called when the object (or any subvalue) changes
 * 
 * @template T
 * 
 * @param {T} input 
 * @param {null|object} parent 
 * @returns {T}
 * 
 * @example
 * let c = { grid: { num_x: 2, num_y: 3 } };
 * 
 * c = make_observable(c)
 * c.onChange((prop, val, obj) => {
 *     console.log(`Property ${prop} changed to ${val}`);
 * })
 * 
 * c.grid={num_x:2,num_y:3} // Triggers the callback\
 * 
 * c.grid.onChange((prop, val, obj) => {
 *     console.log("grid changed!")
 * })
 * 
 * c.grid.num_x = 3; // Triggers the callback
 * c.grid.num_y = 4; // Triggers the callback
 * c.grid['num_z'] = 4; // Triggers the callback
 * 
 */
function make_observable(input, parent=null) {
    if(input instanceof ObservableObject && input._proxy){
        return input
    }

    if(!isObject(input)){
        /** type{ObservableObject<T>}
         * @ts-ignore */
        let ret=make_observable(new ValueObject(input), parent)
        /// @ts-ignore
        return ret
    }

    /// @ts-ignore the input object at this point must be an object
    let obj=new ObservableObject(input, parent)

    /// @ts-ignore
    return obj
}

/**
 * return number of decimal digits of a number (digits after comma)
 * @param {Number} v 
 * @returns {Number}
 */
function getNumDecimalDigits(v){
    let [_,decimalDigits]=v.toString().split(".")
    if(!decimalDigits){
        return 0
    }

    return decimalDigits.length
}

/**
 * adjust number of decimals after number input value changed
 * (e.g. if the step value is 0.1, the input value should have 1 decimal digit)
 * @param {Event} event 
 */
function adjustNumDigitsAfterInput(event){
    let event_target=event.currentTarget || event.target
    if(!event_target){console.error("no event target");return}
    if(!(event_target instanceof HTMLInputElement)){console.error("event target is not HTMLElement",event_target);return}

    // @ts-ignore
    let min_value=parseFloat(event_target.getAttribute("min"))
    // @ts-ignore
    let max_value=parseFloat(event_target.getAttribute("max"))
    // @ts-ignore
    let step_value=parseFloat(event_target.getAttribute("step"))

    let current_value=parseFloat(event_target.value)

    let value_was_changed=false
    if(current_value<min_value){
        current_value=min_value
        value_was_changed=true
    }else if(current_value>max_value){
        current_value=max_value
        value_was_changed=true
    }

    // only overwrite value if it was changed
    // (otherwise the cursor position would be reset to the end of the input field after every single character input in the field)
    if(value_was_changed){
        let current_value_str=current_value.toString()
        if(step_value){
            let num_decmial_digits=getNumDecimalDigits(step_value)
            current_value_str=current_value.toFixed(num_decmial_digits)
        }
        event_target.value=current_value_str
    }
}

/**
 * event to change the value of a numer input field on scroll.
 * triggers an onchange event on the input field as well
 * @param {WheelEvent} event 
 * @returns {void}
 */
function adjustInputNumberOnScroll(event){
    let event_target=event.currentTarget || event.target
    if(!event_target){console.error("no event target");return}
    if(!(event_target instanceof HTMLInputElement)){console.error("event target is not HTMLElement",event_target);return}

    // mimic behaviour of disabled input fields
    let eventTarget_is_disabled=event_target.getAttribute("disabled")
    if(eventTarget_is_disabled != null){
        return
    }

    event.preventDefault()

    let min_value=parseFloat(event_target.getAttribute("min")||"-Infinity")
    let max_value=parseFloat(event_target.getAttribute("max")||"Infinity")
    let step_value=parseFloat(event_target.getAttribute("step")||"1")

    let current_value=parseFloat(event_target.value)

    if(event.deltaY>0){
        current_value-=step_value
    }
    if(event.deltaY<0){
        current_value+=step_value
    }

    if(current_value<min_value){
        current_value=min_value
    }
    if(current_value>max_value){
        current_value=max_value
    }

    let num_decmial_digits=getNumDecimalDigits(step_value)
    event_target.value=current_value.toFixed(num_decmial_digits)

    // emit onchange event on same object
    let on_change_event=new Event("change",{
        bubbles:event.bubbles,
        cancelable:event.cancelable,
    })
    event_target.dispatchEvent(on_change_event)
}
/**
 * this function is used to decode html entities in strings
 * e.g. decodeHtml("\&lt\;") -> "<"
 * @param {string} html
 * @returns {string}
 */
function decodeHtml(html) {
    let parser = new DOMParser();
    let doc = parser.parseFromString(html, 'text/html');
    let ret=doc.documentElement.textContent;
    if(ret==null){throw new Error("could not decode html")}
    return ret
}
/**
 * returns an expression tjat expands {{}} expressions using eval
 * e.g. eval("hi {{1+1}} there"+expand_expressions()) -> "hi 2 there"
 * @returns {string}
 */
function expand_expressions(){
    /// /{{(.*?)}}/g <- old
    /// /{{([\s\S]*?)}}/g <- new
    return `.replace(/{{([\\s\\S]*?)}}/g, (match, p1) => {
        p1=decodeHtml(p1)
        try{
            let __v=eval(p1);
            if(__v){
                return __v.valueOf();
            }
            return __v;
        }catch(e){
            console.warn("error expanding expression",p1,e)
            return match;
        }
    })`
}

/**
 * retrieve all text nodes from an element (includes any levels of nesting)
 * @param {HTMLElement} elem 
 * @returns {[Text]}
 */
function getAllTextNodes(elem) {
    let walker = document.createTreeWalker(elem, NodeFilter.SHOW_TEXT, null)
    let textNodes = []
    let node

    while(node = walker.nextNode()) {
        textNodes.push(node)
    }

    // @ts-ignore
    return textNodes
}

/**
 * central object to manage p: bindings and other reactive functionality
 */
let p={
    /** @type Map<string,HTMLElement> */
    templates:new Map(),

    /** copy values from some tracked javascript object to the dom via element.value
     *  e.g. <input type="number" p:on-objchange(microscope_config.value)="value2value" value="1">
     * @param {EventFuncArgument} info
     */
    value2value(info){
        if(info.value && typeof info.value=="object"){
            console.warn("value2value: value is an object, which is invalid",info.value)
            return
        }
        if(!info.element)return;
        /// @ts-ignore
        info.element.value=info.value
    },
    /**
     * copy values from some tracked javascript object to the dom via element.checked
     * e.g. <input type="number" p:on-objchange(microscope_config.value)="value2value" value="1">
     * @param {EventFuncArgument} info
     */
    value2value_checkbox(info){
        if(info.value && typeof info.value=="object"){
            console.warn("value2value: value is an object, which is invalid",info.value)
            return
        }
        if(!info.element)return;
        /// @ts-ignore
        info.element.checked=info.value
    },
    /**
     * copy values from some tracked javascript object to the innerText of an element
     * @param {*} info 
     */
    value2innerText(info){
        info.element.innerText=info.value
    },

    /**
     * observer that triggers when an element is first drawn
     * (i.e., when it becomes visible)
     * @type {IntersectionObserver}
     */
    observer_first_draw:new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            // If the element is intersecting with the viewport (i.e., it's visible)
            if(entry.isIntersecting) {
                let element=entry.target
                if(!(element instanceof HTMLElement)){console.error("element not HTMLElement");return}

                for(let init_vis_func of p.ensure_elp(element).init_vis_funcs){
                    init_vis_func(element)
                }

                p.observer_first_draw.unobserve(element); // Stop observing this element
            }
        });
    }),
    /**
     * observer that triggers when an element is added to the dom
     * @type {MutationObserver}
     */
    observer_add_to_dom:new MutationObserver((mutations)=>{
        mutations.forEach((mutation)=>{
            if(mutation.type=="childList"){
                for(let node of mutation.addedNodes){
                    if(!(node instanceof HTMLElement))continue

                    p.init(node,true)
                }
            }
        })
    }),
    observer_delta_vis:new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            let element=entry.target
            if(!(element instanceof HTMLElement)){console.error("element not HTMLElement");return}

            // false-y can be null or false
            let element_is_visible=element.getAttribute('_visible')=='true'

            let visibility_has_changed=false

            if(entry.isIntersecting){
                if(!element_is_visible){
                    visibility_has_changed=true
                    element.setAttribute('_visible',"true")
                }
            }else{
                if(element_is_visible){
                    visibility_has_changed=true
                    element.setAttribute('_visible',"false")
                }
            }

            if(visibility_has_changed){
                for(let vis_change_change of p.ensure_elp(element).vis_change_funcs){
                    vis_change_change(entry)
                }
            }
        });
    }),
    /**
     * return the image data of an image element (as array of pixel values)
     * @param {CanvasImageSource & {height:number,width:number}} img_element 
     * @param {boolean} also_return_canvas 
     * @returns {[ImageData]|[ImageData,HTMLCanvasElement,CanvasRenderingContext2D]}
     */
    get_img_data(img_element,also_return_canvas=false){
        const canvas = document.createElement('canvas');
        canvas.width=img_element.width
        canvas.height=img_element.height
    
        // Draw the image on canvas
        const ctx = canvas.getContext('2d');
        if(!ctx){console.error("could not get 2d context");throw new Error("could not get 2d context")}
        ctx.drawImage(img_element, 0, 0);
    
        // Extract image data
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

        if(also_return_canvas){
            return [imageData,canvas,ctx]
        }

        return [imageData]
    },

    /**
     * 
     * @param {KeyboardEvent} event 
     */
    save_config_on_ctrlcmd_s(event){
        /// event triggered by pressing ctrl/cmd+s (save current config as file)

        if ((event.ctrlKey || event.metaKey) && event.key === 's') {
            event.preventDefault()
            
            let config_data_to_download=microscope_config.copyRaw()

            let config_data_blob=new Blob([JSON.stringify(config_data_to_download)],{type:"application/json"})

            let config_data_url=URL.createObjectURL(config_data_blob)

            // Create an anchor element and set the URL as the Blob URL
            var a = document.createElement('a')
            a.href = config_data_url
            a.download = "config.json"

            // Append the anchor to the document and trigger the download
            document.body.appendChild(a)
            a.click()

            // Clean up by removing the element and revoking the Blob URL
            document.body.removeChild(a)
            URL.revokeObjectURL(a.href)
        }
    },

    /**
     * time between pointer entering p:tooltip element and the tooltip being displayed
     */
    tooltip_time_to_display_ms:500.0,
    /**
     * time after pointer leaves p:tooltip element before the tooltip is hidden
     */
    tooltip_time_to_hide_ms:300.0,
    /** tooltip elements for the target element (every element with a tooltop may have its own tooltip element) */
    tooltipElementforTarget:new Map(),
    /** @type {number|undefined} */
    tooltip_timer_to_visible:undefined,
    /**
     * callback that is triggered upon pointer entering a p:tooltip element
     * @param {Event} event 
     * @param {boolean} skip_timeout 
     * @returns 
     */     
    tooltip_begin(event,skip_timeout=false){
        let event_target=event.currentTarget
        if(!(event_target instanceof HTMLElement)){console.error("no event target");throw new Error("no event target")}
        let tooltip_el=this.tooltipElementforTarget.get(event_target)
        if(!tooltip_el){
            let tooltip_template=this.templates.get("tooltip")
            if(!tooltip_template){
                console.error("global tooltip template not found")
                return
            }

            /// @ts-ignore
            tooltip_el=tooltip_template.cloneNode(true).children[0]

            let tooltip_text=event_target.getAttribute("p:tooltip")
            if(!tooltip_text){console.error(event_target,"tooltip element has no tooltip text");return}
            // if tooltip references a whole element, use its innerHTML as tooltip text, and remove that element from its parent
            if(tooltip_text.startsWith("#")){
                let tooltip_text_element=document.querySelector(tooltip_text)
                if(!tooltip_text_element){console.error("tooltip text element not found",tooltip_text);return}
                tooltip_el.innerHTML=tooltip_text_element.innerHTML

                if(tooltip_text_element.parentElement)
                    tooltip_text_element.parentElement.removeChild(tooltip_text_element)
                tooltip_text_element.classList.add("processed")
            }else{
                tooltip_el.innerHTML=tooltip_text
            }

            tooltip_el.element_anker=event_target

            this.tooltipElementforTarget.set(event_target,tooltip_el)
        }

        function clear_timers_to_visible(){
            if(this.tooltip_timer_to_visible){
                clearTimeout(this.tooltip_timer_to_visible)
                this.tooltip_timer_to_visible=undefined
            }

            if(tooltip_el.timer_to_visible){
                clearTimeout(tooltip_el.timer_to_visible)
                tooltip_el.timer_to_visible=undefined
            }
        }

        if(!skip_timeout){
            // if timer is already running, don't start another one
            if(tooltip_el.timer_to_visible && this.tooltip_timer_to_visible===tooltip_el.timer_to_visible){
                return
            }

            if(this.tooltip_timer_to_visible!==tooltip_el.timer_to_visible){
                clearTimeout(this.tooltip_timer_to_visible)
                this.tooltip_timer_to_visible=undefined
            }

            // event.currentTarget is null inside the timeout, so we need to save it here
            let escaping_event={currentTarget:event_target}

            // start timer where if the pointer is hovered over the element for this long, the tooltip is displayed
            tooltip_el.timer_to_visible=setTimeout(function(){
                /// @ts-ignore
                p.tooltip_begin(escaping_event,true)
            },this.tooltip_time_to_display_ms)
            this.tooltip_timer_to_visible=tooltip_el.timer_to_visible

            // disable the timer if the pointer leaves the element
            // (and remove the event listener, so it doesn't get called multiple times)
            function onmouseleave(){
                if(!event_target){console.error("no event target");return}
                event_target.removeEventListener("mouseleave",onmouseleave)
                clear_timers_to_visible()
            }
            event_target.addEventListener("mouseleave",onmouseleave)

            return
        }

        clear_timers_to_visible()

        document.body.appendChild(tooltip_el)
        if(this.active_tooltip){
            this.tooltip_cancel(this.active_tooltip)
        }

        this.active_tooltip=tooltip_el
    },
    /** @type undefined|null|HTMLElement */
    active_tooltip:undefined,
    /**
     * this is called when the mouse leaves the element where the tooltip was triggered
     * @param {Event} event
     * @returns
     */
    tooltip_end(event){
        if(!event.currentTarget){throw new Error("no tooltip element")}
        let tooltip_el=this.tooltipElementforTarget.get(event.currentTarget)
        if(this.active_tooltip!==tooltip_el){
            return
        }

        tooltip_el.visibility_timer=setTimeout((() => {
            this.tooltip_cancel(tooltip_el)
        }).bind(this), this.tooltip_time_to_hide_ms);
    },
    tooltipVisibilityTimers:new Map(),
    /**
     * remove active tooltip from display
     * @param {HTMLElement} tooltip_el 
     */
    tooltip_cancel(tooltip_el){
        
        clearTimeout(this.tooltipVisibilityTimers.get(tooltip_el))
        this.tooltipVisibilityTimers.delete(tooltip_el)

        if(tooltip_el.parentElement){
            tooltip_el.parentElement.removeChild(tooltip_el)
        }

        if(this.active_tooltip===tooltip_el){
            this.active_tooltip=null
        }
    },

    /**
     * map for additional attributes on an element used by this framework
     */
    elp:new Map(),
    /**
     * register a callback that is triggered when an observable object changes
     * @param {HTMLElement} el
     * @return {{
     *   pBindApplied: boolean,
     *   bindings: Binding[],
     *   pForInitialized: boolean,
     *   pForElements: [HTMLElement,Binding[]][],
     *   _destroy: null|(()=>void),
     *   _liveCallbacks: EventFunc[],
     *   vis_change_funcs: ((arg?:IntersectionObserverEntry)=>void)[],
     *   init_vis_funcs: ((arg:HTMLElement)=>void)[],
     * }}
     */
    ensure_elp(el){
        if(!this.elp.has(el)){
            let elp_info={
                pBindApplied:false,
                bindings:[],
                pForInitialized:false,
                pForElements:[],
                _destroy:null,
                _liveCallbacks:[],
                vis_change_funcs:[],
                init_vis_funcs:[],
            }
            this.elp.set(el,elp_info)
            return elp_info
        }
        return this.elp.get(el)
    },

    /**
     * init p:bind functionality for an element
     * @param {HTMLElement} el 
     * @param {string|undefined} obj_bind_in 
     * @param {Binding[]} additional_bindings 
     * @returns 
     */
    apply_pbind(el,obj_bind_in=undefined,additional_bindings=[]){
        let el_info=this.ensure_elp(el)
        if(el_info && el_info.pBindApplied){
            console.log("p:bind already applied",el)
            return
        }

        el_info.pBindApplied=true

        if(el_info.bindings){
            additional_bindings=additional_bindings.concat(el_info.bindings)
        }

        for(let binding of additional_bindings){
            eval("var "+binding.bindname+"=binding.value")
        }

        let obj_bind=""
        let el_pbind=el.getAttribute("p:bind")
        if(obj_bind_in!==undefined){
            obj_bind=obj_bind_in
        }else if(el_pbind){
            obj_bind=el_pbind
        }

        if(obj_bind.length==0){
            return
        }

        let obj=eval(obj_bind)
        if(!isObservable(obj)){
            window.alert("obj_bind not observable '"+obj_bind+"'")
            return
        }

        // if el is <input type="checkbox">, use .target.checked instead of .target.value, and value2value_checkbox instead of value2value

        let value_callback_func=null
        if(el.tagName=="INPUT" || el.tagName=="SELECT"){
            let key=keyOf(obj._parent,obj)

            if(el.getAttribute("type")=="checkbox"){
                el.addEventListener("change",function(ev){
                    /// @ts-ignore
                    obj._parent[key]=ev.target.checked
                })

                value_callback_func=p.value2value_checkbox
            }else{
                // 'input' is called on every keystroke, 'change' is called when the input field loses focus
                // input makes more sense for text input, change for everything else
                let event_type="change"
                if(el.getAttribute("type")=="text"){
                    event_type="input"
                }

                el.addEventListener(event_type,function(ev){
                    /// @ts-ignore
                    obj._parent[key]=ev.target.value
                })

                value_callback_func=p.value2value
            }
        }else{
            value_callback_func=p.value2innerText
        }
        
        this.register_objchange_callback(obj,value_callback_func,el,true)
    },
    /**
     * init p:for functionality for an element
     * @param {HTMLElement} el 
     * @param {string|null} for_clause 
     * @param {Binding[]} additional_bindings 
     * @returns 
     */
    apply_pfor(el,for_clause=null,additional_bindings=[]){
        if(for_clause==undefined){
            for_clause=el.getAttribute("p:for")
        }

        if(!(for_clause && for_clause.length>0)){
            return
        }

        let el_info=this.ensure_elp(el)
        additional_bindings=additional_bindings.concat(el_info.bindings)

        for(let binding of additional_bindings){
            eval("var "+binding.bindname+"=binding.value")
        }

        // matches pattern <bindname> of <container expression>
        let [bindname,container_expression]=for_clause.split(" of ")
        if(bindname==undefined || container_expression==undefined){
            console.error("p:for : invalid 'for' clause (must be 'x of container') '",for_clause,"'")
            return
        }

        // minor optimization, the goal is not to make sure this is only called once (which it is not!)
        let container=undefined
        container=eval(container_expression)

        // initialize container exactly once
        if(!el_info.pForInitialized){
            el_info.pForInitialized=true

            // if the container is observable, register a callback to update the elements when the container changes
            if(isObservable(container)){
                let el_cb=this.register_objchange_callback(container,function(info){
                    // when the container changes, remove all previously created elements
                    if(el_info.pForInitialized===true){
                        for(let [old_child,_old_child_bindings] of el_info.pForElements){
                            let old_child_pinfo=p.ensure_elp(old_child)
                            if(old_child_pinfo._destroy){
                                old_child_pinfo._destroy()
                            }
                            if(old_child.parentElement){
                                old_child.parentElement.removeChild(old_child)
                            }
                        }
                        el_info.pForElements=[]
                    }

                    // then generated new elements
                    // TODO optimization possible: only generate the elements that are actually needed (re-use elements generated from preserved container entries)
                    p.apply_pfor(el,for_clause,additional_bindings)
                },el,false)

                // save the callback to be called when the element is destroyed
                // (removes the callback set above so that it is not called on an object removed from the dom)
                if(!el_cb) return
                el_info._liveCallbacks.push(el_cb)
            }
        }

        if(!isIterable(container)){
            return
        }

        /** @type {[HTMLElement,Binding[]][]} */
        let new_elements=[]

        for(let item of container){
            // eval clause allows <p p:for="item in container"> <input p:bind="item.value"></input> </p>
            eval("var "+bindname+"=item");

            let bindings=[
                {bindname:bindname,value:item}
            ].concat(additional_bindings)

            // instantiate each child of element container for each item in the container
            for(let child_element of el.content.children){
                let new_element=child_element.cloneNode(true);
                
                // eval attributes and innerhtml to allow for {{}} expressions without costly outerhtml changes
                for(let attribute of new_element.attributes){
                    attribute.value=eval('attribute.value'+expand_expressions());
                }
                new_element.innerHTML=eval('new_element.innerHTML'+expand_expressions());
                new_element._bindings=bindings

                new_elements.push([new_element,bindings])
            }
        }

        for(let [new_element,_] of new_elements){
            if(!el.parentElement){console.error("no parent element for",el);return}
            el.parentElement.insertBefore(new_element,el);
        }

        // trigger init functions for all new elements
        for(let [new_element,bindings] of new_elements){
            let pinfo=p.ensure_elp(new_element)
            pinfo.bindings=bindings
            // TODO this should not be required, but the init code is usually only applied to elements with the data class, which these might not have
            p.init(new_element,true,bindings)
        }

        el_info.pForElements=new_elements
        el_info._destroy=function(){
            for(let [old_child,_old_child_bindings] of el_info.pForElements){
                let old_child_pinfo=p.ensure_elp(old_child)
                if(old_child_pinfo._destroy){
                    old_child_pinfo._destroy()
                }
                if(old_child.parentElement){
                    old_child.parentElement.removeChild(old_child)
                }
            }
            // call all live callbacks
            // i.e. functions to unhook existing callbacks from the observable object
            if(el_info._liveCallbacks){
                for(let cb of el_info._liveCallbacks){
                    /// @ts-ignore
                    cb({})
                }
            }
        }
    },

    /**
     * lift template elements out of the subtree and save them in p.templates
     * @param {HTMLElement} subtree_node 
     * @returns
     */
    liftTemplates(subtree_node){
        // save templates for later insertion
        for(let template of subtree_node.querySelectorAll("template")){
            let template_name=template.getAttribute("name")
            if(!template_name){
                continue
            }

            // remove template from DOM
            if(template.parentElement){
                template.parentElement.removeChild(template)
            }

            // save for later use
            this.templates.set(template_name,template.content)
        }
    },

    /**
     * perform initialization of a subtree
     * @param {HTMLElement} subtree 
     * @param {boolean} include_root 
     * @param {Binding[]} additional_bindings 
     * @returns 
     */
    init_node(subtree,include_root=false,additional_bindings=[]){
        if(!subtree.querySelectorAll){
            return
        }

        this.liftTemplates(subtree)

        let subtree_pinfo=this.ensure_elp(subtree)
        additional_bindings=additional_bindings.concat(subtree_pinfo.bindings)

        for(let binding of additional_bindings){
            eval("var "+binding.bindname+"=binding.value")
        }

        // init subnodes with data attribute first
        if(!(include_root && subtree.classList.contains("data"))){
            for(let element of subtree.querySelectorAll(".data")){
                if(!(element instanceof HTMLElement))continue

                // if a parent any number of levels up has the data class, do not initialize here (TODO this is not true)
                let closestDataParent=element.closest(".data")
                if(
                    // TODO make sure elements are initialized bottom-up, but p-for top-down
                    closestDataParent
                    && closestDataParent!=subtree
                    && closestDataParent!=element
                    && subtree.contains(closestDataParent)
                ){
                    console.log("skipping",subtree,element,closestDataParent)
                    continue
                }
                
                this.init_node(element,true,additional_bindings)
            }
            return
        }

        // process elements
        let el_pinfo=this.elp.get(subtree)
        let element=subtree
        let el=element

        if(el_pinfo.init_done===true){
            return
        }

        let calls=[]

        let initExec=element.getAttribute("p:init")
        if(initExec){
            let init_func=function(){
                // may take 'element' as argument
                eval(initExec)
            }

            calls.push(()=>{init_func();})
        }

        let tooltip_text=element.getAttribute("p:tooltip")
        if(tooltip_text){
            element.classList.add("has-tooltip")
            element.addEventListener("mouseenter",this.tooltip_begin)
            element.addEventListener("mouseleave",this.tooltip_end)
        }

        for(let child of element.childNodes){
            let raw_text=child.textContent
            if(!raw_text)
                continue;
            if(child.nodeName=="#text" && raw_text){
                // create list of matches for text within {{}}, including position of match to make splicing easier later
                let matches=[...raw_text.matchAll(/{{(.*?)}}/g)].reverse()
                if(matches.length==0){
                    continue
                }
                function replace(){
                    if(!raw_text)return;
                    let new_text=raw_text
                    for(let match of matches){
                        /**
                         * @template T
                         * @param {T} v
                         * @return {string}
                         */
                        function getInnerValue(v){
                            if(isObservable(v)){
                                /// @ts-ignore
                                return ""+v._obj.valueOf()
                            }
                            return ""+v
                        }
                        let val=getInnerValue(eval(match[1]))
                        new_text=new_text.slice(0,match.index)+val+new_text.slice(match.index+match[0].length)
                    }
                    child.textContent=new_text
                }
                // print start and end index of each match
                for(let match of matches){
                    let cb_obj=eval(match[1])
                    this.register_objchange_callback(cb_obj,replace,element,true)
                }
            }
        }

        // call order:
        // 1) apply p:for
        // 2) apply p:init
        // 3) -- init children --
        // 4) apply p:bind
        // note: currently, no other function (other than of those 3 categories) is called immediately, \
        //   they register event listeners instead

        let for_clause=element.getAttribute("p:for")
        if(for_clause){
            calls.splice(0,0,function(){p.apply_pfor(element,for_clause,additional_bindings);})
        }

        let initVisExec=element.getAttribute("p:init-vis")
        if(initVisExec){
            el_pinfo.init_vis_funcs=[]

            el_pinfo.init_vis_funcs.push(function(){
                // may take 'element' as argument
                eval(initVisExec)
            })

            p.observer_first_draw.observe(element);
        }

        // register all sorts of event callbacks
        for(let attribute of element.attributes){
            if(attribute.name.startsWith("p:on-")){
                let event_name_list=attribute.name.replace("p:on-","")
                
                if(attribute.value.length==0){
                    continue
                }

                let onEventExec="["+attribute.value+"]"
                
                let truncated_event_name_list=event_name_list.split("(")[0].split(",")
                for(let event_name of truncated_event_name_list){
                    /// this is a hack (really only should apply to p:on-[objchange|attrchange](...), in which case the event name list only has a single entry anyway )
                    let extended_event_name=(truncated_event_name_list.length!=1)?null:event_name_list

                    if(event_name=="resize"){
                        // resize observer doesnt work as expected (and is quite slow)
                        // and resize events are triggered when the element itself is being resized, not the parent
                        window.addEventListener("resize",function(event){
                            eval(onEventExec)
                        })
                    }else if(event_name.startsWith("vis-change")){
                        if(el_pinfo.vis_change_funcs==null){
                            el_pinfo.vis_change_funcs=[]
                        }
                        el_pinfo.vis_change_funcs.push(function(){
                            eval(onEventExec)
                        })
                        p.observer_delta_vis.observe(element)
                    }else if(event_name.startsWith("objchange")){
                        if(extended_event_name==null)throw new Error("")
                        let obj_list_string=extended_event_name.replace("objchange(","").replace(")","")
                        let obj_list=obj_list_string.split(",")

                        for(let obj_name of obj_list){
                            this.register_objchange_callback(eval(obj_name),function(info){
                                eval(onEventExec)
                            },element,true)
                        }
                    }else if(event_name.startsWith("attrchange")){
                        if(extended_event_name==null)throw new Error("")
                        let attribute_list=extended_event_name.replace("attrchange(","").replace(")","").split(",")
                        let attribute_change_observer=new MutationObserver(function(mutationsList, observer){
                            mutationsList.forEach(mutation=>{
                                if(mutation.type==="attributes"){
                                    if(mutation.attributeName==null)return;
                                    if(attribute_list.includes(mutation.attributeName)){
                                        console.error("not currently implemented")
                                        //p[event_func_name](mutation.target)
                                    }
                                }
                            })
                        })
                        attribute_change_observer.observe(element,{attributes:true})
                    }else{
                        element.addEventListener(event_name,function(event){
                            eval(onEventExec)
                        })
                    }
                }
            }
        }

        // apply all the calls
        for(let func of calls){
            func()
        }

        // init all children
        this.init_node(element,false,additional_bindings)
        
        let obj_bind=element.getAttribute("p:bind")
        if(obj_bind){
            this.apply_pbind(element,obj_bind,additional_bindings)
        }

        // for all text nodes that contain {{}} expressions, expand them
        for(let textNode of getAllTextNodes(element)){
            textNode.data=eval('textNode.data'+expand_expressions());
        }

        el_pinfo.init_done=true

        //make all number input fields adhere to their min/max values during input and allow using scroll to adjust their values
        let subtree_with_input_tag=[]
        for(let element of subtree.querySelectorAll("input")){
            subtree_with_input_tag.push(element)
        }
        if(include_root && subtree.tagName=="INPUT"){
            subtree_with_input_tag.push(subtree)
        }
        for(let element of subtree_with_input_tag){
            let input_type=element.getAttribute("type")
            if(input_type=="number"){
                element.addEventListener("input",adjustNumDigitsAfterInput)

                let wheel_adjust=element.getAttribute("wheel-adjust")
                if(Boolean(wheel_adjust)===true){
                    element.addEventListener("wheel", adjustInputNumberOnScroll, {passive: false})
                }
            }
        }
    },

    init_done:false,
    /**
     * init p: functionality for a subtree
     * @param {HTMLElement|Document} subtree 
     * @param {boolean} include_root 
     * @param {Binding[]} additional_bindings 
     */
    init(subtree=document,include_root=false,additional_bindings=[]){
        /// @ts-ignore
        this.init_node(subtree,include_root,additional_bindings)

        if(subtree===document){
            this.observer_add_to_dom.observe(document.body,{attributes:false,childList:true,characterData:false,subtree:true})

            this.init_done=true
        }
    },

    /**
     * register event_func to be called on element when obj changes
     * @template T
     * @param {ObservableObject<T>} obj 
     * @param {EventFunc} event_func 
     * @param {HTMLElement} element 
     * @param {boolean} initNowWithCurrentValue
     * @returns {null|EventFunc} function that removes the callback from the list
     */
    register_objchange_callback(obj,event_func,element,initNowWithCurrentValue=false){
        // when obj changes, call event_func, referencing the element/domnode

        // if the root does not exist, error
        if(obj==undefined){
            console.error("objchange: object not found")
            window.alert("objchange: object not found")
            return null
        }

        if(!isObservable(obj)){
            console.error("objchange: object not observable",obj)
            window.alert("objchange: object not observable")
            return null
        }

        /**
         * @type {EventFunc}
         */
        const cb_handle=function(info){
            let [property, value, target]=[info.property,info.value,info.target]
            try{
                value=value.valueOf()
            }catch(e){}

            event_func({
                property:property,
                value:value,
                target:target,
                currentTarget:obj,
                element:element
            })
        }
        let cb_remove_func=obj.onChange(cb_handle);

        if(initNowWithCurrentValue===true){
            cb_handle({property:null,value:obj,target:obj,currentTarget:null,element:element})
        }

        return cb_remove_func
    },
}

// initialize p: functionality once the dom is loaded
document.addEventListener("DOMContentLoaded",function(){
    for(let key in p){
        /// @ts-ignore
        if(typeof p[key] === 'function'){
            /// @ts-ignore
            p[key]=p[key].bind(p)
        }
        /// @ts-ignore
        if(p[key] && isObservable(p[key])){
            /// @ts-ignore
            p[key]=make_observable(p[key])
        }
    }
    p.init()
})
