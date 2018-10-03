 

import moment from "moment";

import {
  getUserId,
} from "@prisma-cms/prisma-auth";

class PrismaProcessor {

  constructor(ctx) {

    if (!ctx) {
      throw (new Error("ctx required"));
    }

    Object.assign(this, {
      // source, 
      // args, 
      ctx,
      // info,
      // Type,
      message: "",
      errors: [],
    });

  }

  // message = {}
  // errors = [];
  // data;
  // success;


  async log(options) {

    if (typeof options === "string") {
      options = {
        message: options,
      };
    }

    let {
      message,
      level = "Info",
      objectType,
      stack,
    } = options;

    if (message === undefined) {
      throw (new Error("Message is undefined"));
    }


    if (message instanceof Error) {
      stack = message.stack;
      message = message.message;
    }

    objectType = objectType !== undefined ? objectType : this.objectType;

    let error;

    switch (level) {

      case "Fatal":

        error = new Error(message);

        // console.log("Error", error);

        stack = error.stack;

        break;

    }


    await this.ctx.db.mutation.createLog({
      data: {
        message,
        objectType,
        level,
        stack,
      },
    });

    if (error) {
      throw (error);
    }

  }


  fatal(message) {
    return this.log({
      message,
      level: "Fatal",
    });
  }

  error(message) {

    if (message instanceof Error || typeof message !== "object") {
      message = {
        message,
      };
    }

    return this.log({
      ...message,
      level: "Error",
    });
  }


  async getUser(required, token, sudo) {

    let {
      currentUser,
    } = this.ctx;


    if (!currentUser && token) {

      const userId = await getUserId(this.ctx, token)
        .catch(error => {
          console.error(error);
        });

      if (userId) {
        currentUser = await this.query("user", {
          where: {
            id: userId,
          },
        });

        if (!currentUser) {
          currentUser = await this.query("user", {
            where: {
              secondID: userId,
            },
          });
        }
      }

    }

    if (!currentUser && required) {
      throw (new Error("Не авторизован"));
    }

    if (sudo && (!currentUser || currentUser.sudo !== true)) {
      throw (new Error("Доступ запрещен"));
    }

    return currentUser;
  }



  hasErrors() {

    return this.success !== undefined || this.errors.length;
  }


  addError(message) {
    this.message = message instanceof Error ? message.message : message;
    this.success = false;
  }


  addFieldError(key, message) {
    this.errors.push({
      key,
      message,
    });
  }


  async mutate(method, args, info) {

    const {
      db,
    } = this.ctx;

    // console.log("mutatoin db", db);
    // console.log("mutatoin db", args);
    // console.log("mutatoin info", info);

    if (!this.hasErrors()) {
      const result = await db.mutation[method](args, info)
        .catch(error => {
          this.addError(error);
          this.error(error);
          throw (error);
        });

      return result;
    }

  }


  async create(objectType, args, info) {

    return await this.mutate(`create${objectType}`, args, info)
      .catch(error => {
        this.error({
          message: error,
          objectType,
        });
        this.addError(error);
        throw (error);
      })
      ;

    // return this.prepareResponse();

  }


  async createWithResponse(objectType, args, info) {

    await this.create(objectType, args, info)
      .then(r => {
        this.data = r;
        return r;
      })
      .catch(error => {

        this.addError(error);
        this.error(error);
        // throw (error); 

      })
      ;

    return this.prepareResponse();

  }



  async update(objectType, args, info) {

    return await this.mutate(`update${objectType}`, args, info)
      .then(r => {
        this.data = r;
        return r;
      })
      .catch(error => {
        this.error({
          message: error,
          objectType,
        });
        this.addError(error);
        throw (error);
      })
      ;

    // return this.prepareResponse();

  }


  async updateWithResponse(objectType, args, info) {

    await this.update(objectType, args, info)
      .then(r => {
        this.data = r;
        return r;
      })
      .catch(error => {
        this.addError(error);
        this.error(error);
        console.error(error);

        // throw (error);
      })
      ;

    return this.prepareResponse();

  }


  async query(method, args, info) {

    const result = await this.ctx.db.query[method](args, info)
      .catch(error => {
        this.addError(error);

        throw (error);
      });

    return result;

  }

  prepareResponse() { 

    const response = {
      success: !this.hasErrors() && this.data ? true : false,
      message: this.message,
      errors: this.errors,
      data: this.data,
    }
 

    return response;

  }



  DateTimeToDate(date) {
    /**
     * Важно делать именно так, чтобы проходил учет часового пояса
     */
    return date ? moment(date).utcOffset(date).format("YYYY-MM-DD HH:mm:ss.000") : undefined;
  }

}

export default PrismaProcessor;